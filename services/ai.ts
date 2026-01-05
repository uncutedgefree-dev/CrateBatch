import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

// Model Configuration - STRICTLY LOCKED TO GEMINI-3-FLASH
const MODEL_NAME = "gemini-3-flash";

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
  error?: string; // Surfaces API errors to the UI
}

export const generateTagsBatch = async (
  tracks: RekordboxTrack[], 
  mode: 'full' | 'missing_genre' | 'missing_year' = 'full'
): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => ({
    id: track.TrackID,
    title: track.Name,
    artist: track.Artist,
    bpm: track.AverageBpm,
    key: track.Tonality,
    comments: track.Comments || "",
    request_mode: mode
  }));

  const systemInstruction = `Task: Music Tagging. Return ONLY JSON. 
  Model: ${MODEL_NAME}.
  ONLY use: VIBES: ${VIBE_TAGS.join(', ')}, GENRES: ${MICRO_GENRE_TAGS.join(', ')}, SITUATIONS: ${SITUATION_TAGS.join(', ')}.`;

  const responseSchema = {
    type: "OBJECT",
    properties: { vibe: { type: "STRING" }, genre: { type: "STRING" }, situation: { type: "STRING" }, release_year: { type: "STRING" } },
    required: ["vibe", "genre", "situation"]
  };

  const fullPrompt = `${systemInstruction}\n\nSchema:\n${JSON.stringify(responseSchema)}\n\nTracks:\n`;

  if (window.electron) {
    try {
      const bridgeResults = await window.electron.enrichBatch({ tracks: tracksPayload, prompt: fullPrompt });
      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0, totalIn = 0, totalOut = 0;
      let lastErrorMessage = "";

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) {
           lastErrorMessage = res.error || "Unknown API error";
           return;
        }
        const usage = res.data.usageMetadata;
        if (usage) {
           const inT = usage.promptTokenCount || 0;
           const outT = usage.candidatesTokenCount || 0;
           totalIn += inT;
           totalOut += outT;
           totalCost += ((inT * 0.000000075) + (outT * 0.00000030));
        }
        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
             const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
             const item = JSON.parse(cleanText);
             resultsMap[res.id] = {
               vibe: validateTag(item.vibe, VIBE_TAGS),
               genre: validateTag(item.genre, MICRO_GENRE_TAGS),
               situation: validateTag(item.situation, SITUATION_TAGS),
               year: item.release_year || item.year || ""
             };
          } catch (err) {}
        }
      });
      
      return { 
        results: resultsMap, 
        usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost },
        error: Object.keys(resultsMap).length === 0 ? lastErrorMessage : undefined
      };
    } catch (e) {
      return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: "Bridge connection failed" };
    }
  }

  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: "Electron not detected" };
};
