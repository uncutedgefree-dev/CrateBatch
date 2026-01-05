import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const result = await generateTagsBatch([track], 'full');
  return result.results[track.TrackID] || { vibe: "Unknown", genre: "Unknown", situation: "Unknown", year: "" };
};

export const interpretSearchQuery = async (query: string): Promise<SmartFilterCriteria> => {
  return { genres: [], vibes: [], situations: [], keywords: [query], isSemantic: false };
};

const validateTag = (tag: string | undefined, allowed: string[]): string => {
  if (!tag) return "Unknown";
  const match = allowed.find(t => t.toLowerCase() === tag.trim().toLowerCase());
  return match || "Unknown";
};

export interface BatchResponse {
  results: Record<string, AIAnalysis>;
  usage: BatchUsage;
  error?: string;
}

export const generateTagsBatch = async (
  tracks: RekordboxTrack[],
  mode: 'full' | 'missing_genre' | 'missing_year' = 'full'
): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => ({
    id: track.TrackID,
    name: track.Name,
    artist: track.Artist,
    bpm: track.AverageBpm,
    key: track.Tonality,
    comments: track.Comments || ""
  }));

  let systemInstruction = `You are an expert music librarian. The current year is 2026.
Task: Analyze the provided list of tracks.`;

  if (mode === 'missing_year') {
    systemInstruction += `
Rules:
1. Identify the ORIGINAL release year. Ignore intro/remaster dates.
2. 2025 and 2026 are valid. Do NOT hallucinate years beyond 2026.
3. If uncertain of the year, use "0".
4. You MUST prioritize accuracy. Search your internal database for the correct release year of these specific songs.

Return a JSON array of objects. 
Each object: {"id": "...", "release_year": "..."}`;
  } else if (mode === 'missing_genre') {
    systemInstruction += `
Rules:
1. Use ONLY the provided tags. Do NOT make up your own.

GENRES: ${MICRO_GENRE_TAGS.join(', ')}

Return a JSON array of objects. 
Each object: {"id": "...", "genre": "..."}`;
  } else {
    systemInstruction += `
Rules:
1. Identify the ORIGINAL release year. Ignore intro/remaster dates.
2. 2025 and 2026 are valid. Do NOT hallucinate years beyond 2026.
3. If uncertain of the year, use "0".
4. Use ONLY the provided tags. Do NOT make up your own.

VIBES: ${VIBE_TAGS.join(', ')}
GENRES: ${MICRO_GENRE_TAGS.join(', ')}
SITUATIONS: ${SITUATION_TAGS.join(', ')}

Return a JSON array of objects. 
Each object: {"id": "...", "vibe": "...", "genre": "...", "situation": "...", "release_year": "..."}`;
  }

  if (window.electron) {
    try {
      const bridgeResults = await window.electron.enrichBatch({ 
        tracks: tracksPayload, 
        prompt: systemInstruction 
      });

      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0, totalIn = 0, totalOut = 0;
      let lastError = "";

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) {
           lastError = res.error || "API Error";
           return;
        }

        const usage = res.data.usageMetadata;
        if (usage) {
           totalIn += usage.promptTokenCount || 0;
           totalOut += usage.candidatesTokenCount || 0;
           totalCost += ((usage.promptTokenCount * 0.000000075) + (usage.candidatesTokenCount * 0.00000030));
        }

        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
             const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
             if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const items = Array.isArray(parsed) ? parsed : [parsed];
                
                items.forEach((item: any) => {
                  if (item.id) {
                    if (mode === 'missing_year') {
                      resultsMap[item.id] = {
                        year: (item.release_year || item.year || "0").toString(),
                        vibe: "Unknown",
                        genre: "Unknown",
                        situation: "Unknown"
                      };
                    } else if (mode === 'missing_genre') {
                      resultsMap[item.id] = {
                        genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                        vibe: "Unknown",
                        situation: "Unknown",
                        year: "0"
                      };
                    } else {
                      resultsMap[item.id] = {
                        vibe: validateTag(item.vibe, VIBE_TAGS),
                        genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                        situation: validateTag(item.situation, SITUATION_TAGS),
                        year: (item.release_year || item.year || "0").toString()
                      };
                    }
                  }
                });
             }
          } catch (err) {
             console.error("Batch parse error:", err);
             lastError = "JSON Parse Error";
          }
        }
      });

      return { 
        results: resultsMap, 
        usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost },
        error: Object.keys(resultsMap).length === 0 ? lastError : undefined 
      };
    } catch (e) {
      return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: "Connection Error" };
    }
  }

  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: "Electron Not Detected" };
};
