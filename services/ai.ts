import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { sleep } from "./utils";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

// Updated to gemini-3-flash
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

export const generateTagsBatch = async (tracks: RekordboxTrack[], mode: 'full' | 'missing_genre' | 'missing_year' = 'full'): Promise<any> => {
  const tracksPayload = tracks.map(track => {
    let energyLevel = track.Energy;
    if (!energyLevel && track.Comments) {
      const energyMatch = track.Comments.match(/Energy\s*:\s*(\d+)/i);
      if (energyMatch && energyMatch[1]) energyLevel = energyMatch[1];
    }
    
    return {
      id: track.TrackID,
      title: track.Name,
      artist: track.Artist,
      bpm: track.AverageBpm,
      key: track.Tonality,
      comments: track.Comments || "",
      energy_instruction: energyLevel ? `Known Energy: ${energyLevel}/10. Match vibe.` : "Estimate intensity."
    };
  });

  const systemInstruction = `Tag music precisely. ONLY use:
  VIBES: ${VIBE_TAGS.join(', ')}
  GENRES: ${MICRO_GENRE_TAGS.join(', ')}
  SITUATIONS: ${SITUATION_TAGS.join(', ')}
  Return JSON format.`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      vibe: { type: "STRING" },
      genre: { type: "STRING" },
      situation: { type: "STRING" },
      release_year: { type: "STRING" },
    },
    required: ["id", "vibe", "genre", "situation"],
  };

  if (window.electron) {
    const fullPrompt = `${systemInstruction}\n\nSchema:\n${JSON.stringify(responseSchema)}\n\nData:\n`;
    
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
           // Flash pricing: $0.075 / 1M input, $0.30 / 1M output
           totalCost += ((inTok * 0.000000075) + (outTok * 0.00000030));
        }

        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
             const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
             const item = json.results ? json.results[0] : json;

             if (item && item.id) {
               resultsMap[item.id] = {
                 vibe: validateTag(item.vibe, VIBE_TAGS),
                 genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                 situation: validateTag(item.situation, SITUATION_TAGS),
                 year: item.release_year
               };
             }
          } catch (err) { console.error("Parse error", err); }
        }
      });

      return {
        results: resultsMap,
        usage: { inputTokens: totalIn, outputTokens: totalOut, cost: totalCost }
      };
    } catch (e) { throw e; }
  }
  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
};

// ... keep interpretSearchQuery and other helpers below ...
