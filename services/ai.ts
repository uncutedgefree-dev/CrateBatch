import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { sleep } from "./utils";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from "./taxonomy";

// API Configuration (Legacy fallback for web mode)
const API_KEY = process.env.API_KEY;
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

// Validation Helper: Ensures tags exist in the strict lists
const validateTag = (tag: string | undefined, allowed: string[]): string => {
  if (!tag) return "Unknown";
  // Case-insensitive check
  const match = allowed.find(t => t.toLowerCase() === tag.trim().toLowerCase());
  return match || "Unknown";
};

// Helper to make the fetch call (Web Fallback)
async function callGemini(prompt: string, systemInstruction: string, responseSchema: any): Promise<{ json: any, usage: BatchUsage }> {
  if (!API_KEY) throw new Error("API_KEY is missing. Check your environment variables.");

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: responseSchema
    }
  };

  const response = await fetch(`${MODEL_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${response.status} - ${err}`);
  }

  const data = await response.json() as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) throw new Error("Empty response from AI");

  const usageMeta = data.usageMetadata || {};
  const inputTokens = usageMeta.promptTokenCount || 0;
  const outputTokens = usageMeta.candidatesTokenCount || 0;
  // Cost approx: $0.075 / 1M input, $0.30 / 1M output (Flash Pricing)
  const cost = ((inputTokens * 0.000000075) + (outputTokens * 0.00000030));

  let json;
  try {
    // Sometimes the model wraps JSON in markdown blocks despite mime_type
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    json = JSON.parse(cleanText);
  } catch (e) {
    console.error("Failed to parse AI response", text);
    throw new Error("Invalid JSON format from AI");
  }

  return { json, usage: { inputTokens, outputTokens, cost } };
}

export const generateTags = async (track: RekordboxTrack): Promise<AIAnalysis> => {
  // Refined Energy Logic
  let energyLevel = track.Energy;
  if (!energyLevel && track.Comments) {
    const energyMatch = track.Comments.match(/Energy\s*:\s*(\d+)/i);
    if (energyMatch && energyMatch[1]) {
      energyLevel = energyMatch[1];
    }
  }

  const energyInstruction = energyLevel 
    ? `The known Energy Level is ${energyLevel}/10. Ensure your Vibe description matches this intensity.` 
    : "Estimate the energy level based on the BPM and Genre.";

  const content = `
    Track Name: ${track.Name}
    Artist: ${track.Artist}
    BPM: ${track.AverageBpm}
    Key: ${track.Tonality}
    Comments: ${track.Comments}

    Special Instruction: ${energyInstruction}
  `;

  const systemInstruction = `You are a music tagging engine.
Your Task: Assign exactly one tag per category for this track.

CRITICAL CONSTRAINT: You must ONLY select values from the provided lists below. Do not invent new tags.

[LISTS]
VIBES: ${VIBE_TAGS.join(', ')}
MICRO_GENRES: ${MICRO_GENRE_TAGS.join(', ')}
SITUATIONS: ${SITUATION_TAGS.join(', ')}

Output Format: Return ONLY a JSON object.`;

  const schema = {
    type: "OBJECT",
    properties: {
      vibe: { type: "STRING" },
      genre: { type: "STRING" },
      situation: { type: "STRING" },
      release_year: { type: "STRING", description: "Estimate the release year (YYYY)" },
    },
    required: ["vibe", "genre", "situation"],
  };

  try {
    const { json } = await callGemini(content, systemInstruction, schema);
    return {
      vibe: validateTag(json.vibe, VIBE_TAGS),
      genre: validateTag(json.genre, MICRO_GENRE_TAGS),
      situation: validateTag(json.situation, SITUATION_TAGS),
      year: json.release_year
    };
  } catch (e) {
    console.error("Failed to generate tags", e);
    throw e;
  }
};

/**
 * Smart Search Interpretation
 */
export const interpretSearchQuery = async (query: string): Promise<SmartFilterCriteria> => {
  const systemInstruction = `You are a DJ Library Search Assistant.
  Your goal is to convert a user's natural language search query into structured filter criteria.
  
  [TAXONOMY REFERENCE]
  VIBES: ${VIBE_TAGS.join(', ')}
  GENRES: ${MICRO_GENRE_TAGS.join(', ')}
  SITUATIONS: ${SITUATION_TAGS.join(', ')}
  
  Rules:
  1. Map descriptive words to the closest matching Tags from the reference lists.
  2. IF A WORD IS MAPPED TO A TAG (Vibe, Genre, Situation), DO NOT INCLUDE IT IN 'keywords'.
  3. 'keywords' should ONLY contain specific entities not in the taxonomy.
  4. Extract numeric ranges for BPM, Year, and Energy.
  5. Extract Camelot Keys if mentioned.`;

  const schema = {
    type: "OBJECT",
    properties: {
      genres: { type: "ARRAY", items: { type: "STRING" } },
      vibes: { type: "ARRAY", items: { type: "STRING" } },
      situations: { type: "ARRAY", items: { type: "STRING" } },
      minBpm: { type: "NUMBER", nullable: true },
      maxBpm: { type: "NUMBER", nullable: true },
      minYear: { type: "NUMBER", nullable: true },
      maxYear: { type: "NUMBER", nullable: true },
      minEnergy: { type: "NUMBER", nullable: true },
      maxEnergy: { type: "NUMBER", nullable: true },
      keys: { type: "ARRAY", items: { type: "STRING" } },
      keywords: { type: "ARRAY", items: { type: "STRING" } }
    },
    required: ["genres", "vibes", "situations", "keywords"]
  };

  try {
    const { json } = await callGemini(query, systemInstruction, schema);
    return {
      ...json,
      isSemantic: true
    };
  } catch (e) {
    console.error("Failed to parse search interpretation", e);
    return {
       genres: [], vibes: [], situations: [], keywords: [query], isSemantic: false
    };
  }
};

interface BatchResponse {
  results: Record<string, AIAnalysis>;
  usage: BatchUsage;
}

export const generateTagsBatch = async (tracks: RekordboxTrack[], mode: 'full' | 'missing_genre' | 'missing_year' = 'full'): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => {
    let energyLevel = track.Energy;
    if (!energyLevel && track.Comments) {
      const energyMatch = track.Comments.match(/Energy\s*:\s*(\d+)/i);
      if (energyMatch && energyMatch[1]) {
        energyLevel = energyMatch[1];
      }
    }
    
    return {
      id: track.TrackID,
      title: track.Name,
      artist: track.Artist,
      bpm: track.AverageBpm,
      key: track.Tonality,
      comments: track.Comments || "",
      energy_instruction: energyLevel 
        ? `Known Energy Level: ${energyLevel}/10. Match vibe intensity.` 
        : "Estimate energy from BPM/Genre."
    };
  });

  // Prepare System Instruction
  let systemInstruction = "";
  let responseSchema: any = {};

  if (mode === 'missing_year') {
    systemInstruction = `You are a music librarian.
    Your Task: Estimate the original release Year (YYYY) for this track.
    [OUTPUT FORMAT] Return a JSON object: { "id": "track_id", "release_year": "YYYY" }`;

    responseSchema = {
       type: "OBJECT",
       properties: {
          results: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, release_year: { type: "STRING" }}, required: ["id", "release_year"]}}
       }
    };

  } else if (mode === 'missing_genre') {
    systemInstruction = `You are a music tagging engine.
    Your Task: Assign exactly one genre from the allowed list.
    CRITICAL CONSTRAINT: You must ONLY select values from the provided MICRO_GENRES list below.
    [LISTS] MICRO_GENRES: ${MICRO_GENRE_TAGS.join(', ')}
    [OUTPUT FORMAT] Return a JSON object: { "id": "track_id", "genre": "One value from MICRO_GENRES list" }`;

    responseSchema = {
        type: "OBJECT",
        properties: {
           results: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, genre: { type: "STRING" }}, required: ["id", "genre"]}}
        }
    };
  } else {
    // Full Mode
    systemInstruction = `You are a music tagging engine. 
Your Task: Assign exactly one tag per category for this track.

CRITICAL CONSTRAINT: You must ONLY select values from the provided lists below. Do not invent new tags.

[LISTS]
VIBES: ${VIBE_TAGS.join(', ')}
MICRO_GENRES: ${MICRO_GENRE_TAGS.join(', ')}
SITUATIONS: ${SITUATION_TAGS.join(', ')}

[OUTPUT FORMAT]
Return a JSON object:
{
  'id': 'original_track_id',
  'vibe': 'One value from VIBES list',
  'genre': 'One value from MICRO_GENRES list',
  'situation': 'One value from SITUATIONS list',
  'release_year': 'Estimated Release Year YYYY'
}`;

    responseSchema = {
      type: "OBJECT",
      properties: {
        results: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              vibe: { type: "STRING" },
              genre: { type: "STRING" },
              situation: { type: "STRING" },
              release_year: { type: "STRING" },
            },
            required: ["id", "vibe", "genre", "situation"],
          },
        },
      },
      required: ["results"],
    };
  }

  // ------------------------------------------------------------------
  // ELECTRON ENGINE (Unlimited Concurrency via Node.js)
  // ------------------------------------------------------------------
  // Check for window.electron presence only (Removed API_KEY check)
  if (window.electron) {
    const fullPrompt = `${systemInstruction}\n\nStrictly follow this JSON Schema:\n${JSON.stringify(responseSchema)}\n\nTrack Data:\n`;
    
    try {
      // Call bridge WITHOUT the apiKey property
      const bridgeResults = await window.electron.enrichBatch({
        tracks: tracksPayload,
        prompt: fullPrompt
      });

      const resultsMap: Record<string, AIAnalysis> = {};
      let totalCost = 0;
      let totalInTokens = 0;
      let totalOutTokens = 0;

      bridgeResults.forEach((res: any) => {
        if (!res.success || !res.data) return;

        // Parse Usage from Raw Axios Response (Gemini API format)
        const usage = res.data.usageMetadata;
        if (usage) {
           const inTok = usage.promptTokenCount || 0;
           const outTok = usage.candidatesTokenCount || 0;
           totalInTokens += inTok;
           totalOutTokens += outTok;
           totalCost += ((inTok * 0.000000075) + (outTok * 0.00000030));
        }

        // Parse Content
        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
             const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
             const json = JSON.parse(cleanText);
             
             let item = json;
             if (json.results && Array.isArray(json.results)) {
                 item = json.results[0];
             }

             if (item && item.id) {
               resultsMap[item.id] = {
                 vibe: validateTag(item.vibe, VIBE_TAGS),
                 genre: validateTag(item.genre, MICRO_GENRE_TAGS),
                 situation: validateTag(item.situation, SITUATION_TAGS),
                 year: item.release_year
               };
             }
          } catch (err) {
            console.error("Failed to parse individual electron result", err);
          }
        }
      });

      return {
        results: resultsMap,
        usage: {
          inputTokens: totalInTokens,
          outputTokens: totalOutTokens,
          cost: totalCost
        }
      };

    } catch (e) {
      console.error("Electron Bridge Error:", e);
      throw e;
    }
  }

  // ------------------------------------------------------------------
  // WEB / BROWSER FALLBACK (REST API)
  // ------------------------------------------------------------------
  
  const prompt = JSON.stringify(tracksPayload);
  
  let attempt = 0;
  const maxRetries = 3;
  let delayMs = 5000;

  while (attempt <= maxRetries) {
    try {
      const { json, usage } = await callGemini(prompt, systemInstruction, responseSchema);

      const resultsMap: Record<string, AIAnalysis> = {};
      const resultsArray = json.results as any[];
      
      if (!Array.isArray(resultsArray)) {
        throw new Error("AI response 'results' is not an array");
      }

      resultsArray.forEach(item => {
        if (item.id) {
          if (mode === 'missing_genre') {
             resultsMap[item.id] = {
               vibe: "", 
               genre: validateTag(item.genre, MICRO_GENRE_TAGS),
               situation: ""
             };
          } else if (mode === 'missing_year') {
             resultsMap[item.id] = {
               vibe: "",
               genre: "",
               situation: "",
               year: item.release_year 
             };
          } else {
             resultsMap[item.id] = {
               vibe: validateTag(item.vibe, VIBE_TAGS),
               genre: validateTag(item.genre, MICRO_GENRE_TAGS),
               situation: validateTag(item.situation, SITUATION_TAGS),
               year: item.release_year 
             };
          }
        }
      });
      
      return { results: resultsMap, usage };

    } catch (e: any) {
      console.warn(`Batch Attempt ${attempt + 1} failed (${e.message}). Retrying...`);
      if (attempt === maxRetries) {
        return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 } }; 
      }
      await sleep(delayMs);
      attempt++;
      delayMs *= 2; 
    }
  }

  return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
};
