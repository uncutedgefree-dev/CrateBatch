import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

// 1. Model Configuration
// Using gemini-3-flash as requested
const MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent";

/**
 * 2. SINGLE TRACK ENRICHMENT
 * Required by App.tsx
 */
export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  const result = await generateTagsBatch([track], 'full');
  return result.results[track.TrackID] || { 
    vibe: "Unknown", 
    genre: "Unknown", 
    situation: "Unknown", 
    year: "" 
  };
};

/**
 * 3. SEMANTIC SEARCH INTERPRETATION
 * Required by App.tsx
 */
export const interpretSearchQuery = async (query: string): Promise<SmartFilterCriteria> => {
  // Simple pass-through as search is keyword-based in the UI for now
  return {
    genres: [],
    vibes: [],
    situations: [],
    keywords: [query],
    isSemantic: false
  };
};

// Internal helper for tag validation
const validateTag = (tag: string | undefined, allowed: string[]): string => {
  if (!tag) return "Unknown";
  const match = allowed.find(t => t.toLowerCase() === tag.trim().toLowerCase());
  return match || "Unknown";
};

/**
 * 4. BATCH PROCESSING ENGINE
 * Uses gemini-3-flash via Electron IPC
 */
export interface BatchResponse {
  results: Record<string, AIAnalysis>;
  usage: BatchUsage;
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
    request_mode: mode // Using 'mode' to satisfy compiler
  }));

  const systemInstruction = `Task: Music Tagging. 
  URL Context: ${MODEL_URL} 
  ONLY use: VIBES: ${VIBE_TAGS.join(', ')}, GENRES: ${MICRO_GENRE_TAGS.join(', ')}, SITUATIONS: ${SITUATION_TAGS.join(', ')}.
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
      console.log(`Sending ${tracksPayload.length} tracks to Electron Bridge...`);
      const bridgeResults = await window.electron.enrichBatch({
        tracks: tracksPayload,
        prompt: fullPrompt
      });
      console.log(`Received ${bridgeResults.length} results from Electron Bridge.`);

      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0, totalIn = 0, totalOut = 0;

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) {
           console.warn(`Track ${res.id} failed or has no data:`, res.error);
           return;
        }

        // Process Usage Metadata
        const usage = res.data.usageMetadata;
        if (usage) {
           const inTok = usage.promptTokenCount || 0;
           const outTok = usage.candidatesTokenCount || 0;
           totalIn += inTok;
           totalOut += outTok;
           // Flash Pricing: $0.075/1M input, $0.30/1M output
           totalCost += ((inTok * 0.000000075) + (outTok * 0.00000030));
        }

        // Process AI Response Content
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
                 year: item.release_year || item.year || ""
               };
             }
          } catch (err) {
            console.error("JSON Parse error for track:", res.id, err);
          }
        }
      });

      return {
        results: resultsMap,
        usage: { 
          inputTokens: totalIn, 
          outputTokens: totalOut, 
          cost: totalCost 
        }
      };
    } catch (e) {
      console.error("Batch processing failed:", e);
      throw e;
    }
  } else {
    console.error("Electron Bridge NOT detected. Falling back to empty response.");
  }

  // Fallback for non-electron environments
  return { 
    results: {}, 
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 } 
  };
};
