import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

// NO BUNDLED KEY - SECURE PROXY MODE
// LIVE PROXY URL from successful deployment
const ENRICH_PROXY_URL = "https://enrichbatch-nxf6vuupsq-uc.a.run.app";

// Updated to use the consistent Cloud Run URL format matching the working enrich function
// Derived from: enrichbatch-nxf6vuupsq-uc.a.run.app -> generateplaylist-nxf6vuupsq-uc.a.run.app
const PLAYLIST_PROXY_URL = "https://generateplaylist-nxf6vuupsq-uc.a.run.app";

export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const result = await generateTagsBatch([track], 'full');
  return result.results[track.TrackID] || { vibe: "Unknown", genre: "Unknown", situation: "Unknown", year: "" };
};

export const interpretSearchQuery = async (query: string): Promise<SmartFilterCriteria> => {
  try {
    const response = await fetch(PLAYLIST_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query, 
        taxonomy: { vibes: VIBE_TAGS, genres: MICRO_GENRE_TAGS, situations: SITUATION_TAGS } 
      })
    });

    const res = await response.json();
    if (!res.success) throw new Error(res.error || "Playlist Gen Error");

    const data = res.data;
    
    // Convert text output to structured data if AI returned string
    let parsedData = data;
    if (typeof data === 'string') {
        const jsonMatch = data.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
    }

    return {
      keywords: parsedData.keywords || [],
      genres: parsedData.genres || [],
      vibes: parsedData.vibes || [],
      situations: parsedData.situations || [],
      minBpm: parsedData.minBpm,
      maxBpm: parsedData.maxBpm,
      minYear: parsedData.minYear,
      maxYear: parsedData.maxYear,
      minEnergy: parsedData.minEnergy,
      maxEnergy: parsedData.maxEnergy,
      keys: parsedData.keys,
      isSemantic: true
    };

  } catch (error) {
    console.error("Semantic Search Failed:", error);
    // Fallback to basic keyword search
    return { genres: [], vibes: [], situations: [], keywords: [query], isSemantic: false };
  }
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
    systemInstruction += `\nRules:\n1. Identify ORIGINAL release year.\n2. 2025/2026 are valid.\n3. Uncertain? Use "0".\nReturn JSON: [{"id": "...", "release_year": "..."}]`;
  } else if (mode === 'missing_genre') {
    systemInstruction += `\nRules:\n1. Use ONLY these GENRES: ${MICRO_GENRE_TAGS.join(', ')}\nReturn JSON: [{"id": "...", "genre": "..."}]`;
  } else {
    systemInstruction += `\nRules:\n1. Identify ORIGINAL release year.\n2. Use ONLY tags provided.\nVIBES: ${VIBE_TAGS.join(', ')}\nGENRES: ${MICRO_GENRE_TAGS.join(', ')}\nSITUATIONS: ${SITUATION_TAGS.join(', ')}\nReturn JSON: [{"id": "...", "vibe": "...", "genre": "...", "situation": "...", "release_year": "...", "hashtags": "#Genre #Vibe #Situation"}]`;
  }

  try {
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: tracksPayload, prompt: systemInstruction })
    });

    const res = await response.json();
    if (!res.success) throw new Error(res.error || "Proxy Error");

    const resultsMap: Record<string, AIAnalysis> = {};
    const usage = res.data.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
    const cost = ((usage.promptTokenCount * 0.000000075) + (usage.candidatesTokenCount * 0.00000030));

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
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
              year: (item.release_year || item.year || "0").toString(),
              hashtags: item.hashtags
            };
          }
        });
      }
    }

    return { 
      results: resultsMap, 
      usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, cost },
      error: Object.keys(resultsMap).length === 0 ? "No data returned" : undefined 
    };
  } catch (e: any) {
    return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: e.message };
  }
};
