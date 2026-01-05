import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

const MODEL_NAME = "gemini-3-flash-preview";

export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const result = await generateTagsBatch([track]);
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
  tracks: RekordboxTrack[]
): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => ({
    id: track.TrackID,
    name: track.Name,
    artist: track.Artist,
    bpm: track.AverageBpm,
    key: track.Tonality,
    comments: track.Comments || ""
  }));

  const systemInstruction = `Task: Tag the following list of music tracks. 
  Model: ${MODEL_NAME}.
  Return a JSON array of objects. 
  Each object MUST have: "id" (matching the track id), "vibe", "genre", "situation", "release_year".
  
  Allowed Values:
  VIBES: ${VIBE_TAGS.join(', ')}
  GENRES: ${MICRO_GENRE_TAGS.join(', ')}
  SITUATIONS: ${SITUATION_TAGS.join(', ')}`;

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
                    resultsMap[item.id] = {
                      vibe: validateTag(item.vibe, VIBE_TAGS),
                      genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                      situation: validateTag(item.situation, SITUATION_TAGS),
                      year: (item.release_year || item.year || "").toString()
                    };
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
