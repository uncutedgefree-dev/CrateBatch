import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { sleep } from "./utils";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

const MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent";

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text: string }[]
    }
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

const validateTag = (tag: string | undefined, allowed: string[]): string => {
  if (!tag) return "Unknown";
  const match = allowed.find(t => t.toLowerCase() === tag.trim().toLowerCase());
  return match || "Unknown";
};

/**
 * 1. SINGLE TRACK ENRICHMENT (Required by App.tsx)
 */
export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const payload = [{
    id: track.TrackID,
    title: track.Name,
    artist: track.Artist,
    bpm: track.AverageBpm,
    key: track.Tonality,
    comments: track.Comments || ""
  }];

  const result = await generateTagsBatch(payload as any, 'full');
  const trackId = track.TrackID;
  return result.results[trackId] || { vibe: "Unknown", genre: "Unknown", situation: "Unknown", year: "" };
};

/**
 * 2. SEMANTIC SEARCH (Required by App.tsx)
 */
export const interpretSearchQuery = async (query: string): Promise<SmartFilterCriteria> => {
  // Simple fallback since the backend handles main batches
  return {
    genres: [], vibes: [], situations: [], keywords: [query], isSemantic: false
  };
};

/**
 * 3. BATCH PROCESSING ENGINE
 */
export interface BatchResponse {
  results: Record<string, AIAnalysis>;
  usage: BatchUsage;
}

export const generateTagsBatch = async (tracks: RekordboxTrack[], mode: 'full' | 'missing_genre' | 'missing_year' = 'full'): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => ({
    id: track.TrackID || (track as any).id,
    title: track.Name || (track as any).title,
    artist: track.Artist || (track as any).artist,
    bpm: track.AverageBpm || (track as any).bpm,
    key: track.Tonality || (track as any).key,
    comments: track.Comments || (track as any).comments || ""
  }));

  const systemInstruction = `Task: Music Tagging. 
  ONLY use these tags:
  VIBES: ${VIBE_TAGS.join(', ')}
  GENRES: ${MICRO_GENRE_TAGS.join(', ')}
  SITUATIONS: ${SITUATION_TAGS.join(', ')}
  Return ONLY JSON.`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      vibe: { type: "STRING" },
      genre: { type: "STRING" },
      situation: { type: "STRING" },
      release_year: { type: "STRING" }
    },
    required: ["vibe", "genre", "situation"]
  };

  if (window.electron) {
    const fullPrompt = `${systemInstruction}\n\nSchema:\n${JSON.stringify(responseSchema)}\n\nTracks:\n`;
    
    try {
      const bridgeResults = await window.electron.enrichBatch({
        tracks: tracksPayload,
        prompt: fullPrompt
      });

      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0, totalIn = 0, totalOut = 0;

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) return;

        const usage = res.data.usageMetadata;
        if (usage) {
           const inTok = usage.promptTokenCount || 0;
           const outTok = usage.candidatesTokenCount || 0;
           totalIn += inTok;
           totalOut += outTok;
           totalCost += ((inTok * 0.000000075) + (outTok * 0.00000030));
        }

        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
             const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
             const item = JSON.parse(cleanText);

             if (item) {
               resultsMap[res.id] = {
                 vibe: validateTag(item.vibe, VIBE_TAGS),
                 genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                 situation: validateTag(item.situation, SITUATION_TAGS),
                 year: item.release_year || item.year
               };
             }
          } catch (err) {
            console.error("Parse error for track", res.id, err);
          }
        }
      });

      return {
        results: resultsMap,
        usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost }
      };
    } catch (e) {
      console.error("Batch failure:", e);
      throw e;
    }
  }

  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
};
