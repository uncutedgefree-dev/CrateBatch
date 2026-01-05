import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";
import axios from 'axios';

// 1. Model Configuration
const MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent";

export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const result = await generateTagsBatch([track], 'full');
  return result.results[track.TrackID] || { 
    vibe: "Unknown", 
    genre: "Unknown", 
    situation: "Unknown", 
    year: "" 
  };
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
}

/**
 * 4. BATCH PROCESSING ENGINE
 */
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
  ONLY use: VIBES: ${VIBE_TAGS.join(', ')}, GENRES: ${MICRO_GENRE_TAGS.join(', ')}, SITUATIONS: ${SITUATION_TAGS.join(', ')}.`;

  const responseSchema = {
    type: "OBJECT",
    properties: { vibe: { type: "STRING" }, genre: { type: "STRING" }, situation: { type: "STRING" }, release_year: { type: "STRING" } },
    required: ["vibe", "genre", "situation"]
  };

  const fullPrompt = `${systemInstruction}\n\nSchema:\n${JSON.stringify(responseSchema)}\n\nTracks:\n`;

  // --- ATTEMPT 1: ELECTRON BRIDGE ---
  if (window.electron) {
    try {
      const bridgeResults = await window.electron.enrichBatch({ tracks: tracksPayload, prompt: fullPrompt });
      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0, totalIn = 0, totalOut = 0;

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) return;
        const usage = res.data.usageMetadata;
        if (usage) {
           totalIn += usage.promptTokenCount || 0;
           totalOut += usage.candidatesTokenCount || 0;
           totalCost += ((totalIn * 0.000000075) + (totalOut * 0.00000030));
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
      if (Object.keys(resultsMap).length > 0) return { results: resultsMap, usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost } };
    } catch (e) {}
  }

  // --- ATTEMPT 2: BROWSER DIRECT (GitHub Secret via Vite) ---
  // Try to find the API key in all possible places (process.env, import.meta.env, etc)
  const API_KEY = (process.env as any).GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || (window as any).GEMINI_API_KEY;

  if (API_KEY) {
    const resultsMap: Record<string, AIAnalysis> = {};
    let totalCost = 0, totalIn = 0, totalOut = 0;

    for (const track of tracksPayload) {
      try {
        const response = await axios.post(`${MODEL_URL}?key=${API_KEY}`, {
          contents: [{ role: 'user', parts: [{ text: fullPrompt + JSON.stringify(track) }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
        });

        const data = response.data;
        const usage = data.usageMetadata;
        if (usage) {
           totalIn += usage.promptTokenCount || 0;
           totalOut += usage.candidatesTokenCount || 0;
           totalCost += (((usage.promptTokenCount || 0) * 0.000000075) + ((usage.candidatesTokenCount || 0) * 0.00000030));
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const item = JSON.parse(cleanText);
          resultsMap[track.id] = {
            vibe: validateTag(item.vibe, VIBE_TAGS),
            genre: validateTag(item.genre, MICRO_GENRE_TAGS),
            situation: validateTag(item.situation, SITUATION_TAGS),
            year: item.release_year || item.year || ""
          };
        }
      } catch (err) {
        console.error("Direct API fail:", err);
      }
    }
    return { results: resultsMap, usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost } };
  }

  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
};
