import { RekordboxTrack, AIAnalysis, BatchUsage, SmartFilterCriteria } from "../types";
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS, MAIN_GENRE_TAGS } from "./taxonomy";

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
    // Construct the prompt for the search interpretation
    const prompt = `
      You are an expert DJ music librarian.
      User Query: "${query}"
      
      Your goal is to translate this request into a structured JSON filter object.
      
      Available Taxonomy:
      Vibes: ${JSON.stringify(VIBE_TAGS)}
      Genres: ${JSON.stringify(MICRO_GENRE_TAGS)}
      Situations: ${JSON.stringify(SITUATION_TAGS)}
      
      Instructions:
      1. Analyze the query for semantic meaning (mood, energy, era, genre, setting).
      2. Map these concepts to the provided taxonomy tags where possible.
      3. Extract specific constraints like BPM range, Year range, or Energy level (1-10).
      4. "keywords" should ONLY contain specific Artist names, Track titles, or Record Labels found in the query.
      5. DO NOT include generic words like "song", "track", "music", "mix", "best", "playlist" in "keywords".
      6. DO NOT include words that you have already mapped to a Vibe, Genre, or Situation in "keywords". (e.g. if you mapped "Love" to "Romantic", do NOT add "Love" to keywords).
      7. Return ONLY a JSON object.
      
      JSON Schema:
      {
        "keywords": ["string"], // Free text keywords found in query
        "genres": ["string"],   // Matched exact taxonomy genres
        "vibes": ["string"],    // Matched exact taxonomy vibes
        "situations": ["string"], // Matched exact taxonomy situations
        "minBpm": number | null,
        "maxBpm": number | null,
        "minYear": number | null,
        "maxYear": number | null,
        "minEnergy": number | null,
        "maxEnergy": number | null,
        "explanation": "string" // Brief explanation of why these filters were chosen
      }
    `;

    const response = await fetch(PLAYLIST_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query, 
        taxonomy: { vibes: VIBE_TAGS, genres: MICRO_GENRE_TAGS, situations: SITUATION_TAGS },
        prompt: prompt,
        model: "gemini-3-flash-preview" // Using requested flash model
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
    
    // Double check: if response has candidates (Cloud Run direct), parse that
    if (!parsedData && data.candidates) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
         if (text) {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
         }
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
  mode: 'full' | 'missing_genre' | 'missing_year' = 'full',
  isRetry: boolean = false
): Promise<BatchResponse> => {
  const tracksPayload = tracks.map(track => ({
    id: track.TrackID,
    name: track.Name,
    artist: track.Artist,
    bpm: track.AverageBpm,
    key: track.Tonality,
    comments: track.Comments || ""
  }));

  // Force current year to 2026 as per user instruction
  const currentYear = 2026;
  let systemInstruction = `You are an expert music librarian. The current year is ${currentYear}.
Task: Analyze the provided list of tracks.`;

  // MODEL SELECTION STRATEGY
  // Initial Pass: Gemini 3 Flash Preview (Internal Knowledge)
  // Retry Pass: Gemini 2.5 Pro (Grounded Search)
  const model = isRetry ? "gemini-2.5-pro" : "gemini-3-flash-preview";
  
  if (mode === 'missing_year') {
    if (isRetry) {
        // RETRY PROMPT: GROUNDED SEARCH
        systemInstruction += `\nMODE: DEEP SEARCH (GROUNDING ENABLED)
Rules:
1. USE GOOGLE SEARCH to find the exact release date of the track.
2. If the track is a DJ Utility Edit (Intro, Dirty, Club Edit), you MUST find the **ORIGINAL SONG'S** release year.
   - Example: "50 Cent - In Da Club (DJCity Intro)" -> Search for "50 Cent In Da Club Release Date" -> Return "2003".
3. Verify the artist and title matches exactly.
4. If it is a Remix or Cover, find the release year of that specific version.
5. Return "0" ONLY if absolutely no information exists on the internet.
6. Valid Range: 1950-${currentYear}.
Return JSON: [{"id": "...", "release_year": "..."}]`;
    } else {
        // INITIAL PROMPT: INTERNAL KNOWLEDGE
        systemInstruction += `\nRules:
1. Identify the ORIGINAL release year using your internal knowledge.
2. Identify if the track is a "Utility Edit" (DJ Intro, Redrum, Club Edit, Extended Mix).
3. FOR UTILITY EDITS: Return the ORIGINAL song release year.
   - Example: "50 Cent - In Da Club (DJCity Intro)" -> "2003" (Original).
4. FOR REMIXES/COVERS: Return the year of that specific version.
5. **CONFIDENCE CHECK**: If you are less than 90% confident, or if the track is obscure, return "0". We will check it with a search engine in the next step.
6. Valid Range: 1950-${currentYear}.
Return JSON: [{"id": "...", "release_year": "..."}]`;
    }
  } else if (mode === 'missing_genre') {
    systemInstruction += `\nRules:
1. Identify the BROAD MAIN GENRE for the track.
2. Use ONLY these Broad Genres: ${MAIN_GENRE_TAGS.join(', ')}
3. Return JSON: [{"id": "...", "genre": "..."}]`;
  } else {
    // FULL MODE
    systemInstruction += `\nRules:
1. Identify ORIGINAL release year.
2. Use ONLY tags provided.
3. STRICTLY IGNORE BPM when determining Genre.
4. VIBES: ${VIBE_TAGS.join(', ')}
5. GENRES: ${MICRO_GENRE_TAGS.join(', ')}
6. SITUATIONS: ${SITUATION_TAGS.join(', ')}
Return JSON: [{"id": "...", "vibe": "...", "genre": "...", "situation": "...", "release_year": "...", "hashtags": "#Genre #Vibe #Situation"}]`;
  }

  try {
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tracks: tracksPayload, 
        prompt: systemInstruction,
        model: model,
        googleSearch: isRetry // Enable grounding only on retry
      })
    });

    const res = await response.json();
    if (!res.success) throw new Error(res.error || "Proxy Error");

    const resultsMap: Record<string, AIAnalysis> = {};
    const usage = res.data.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
    
    // Cost estimation (approximate relative diff)
    const inputCostPerToken = isRetry ? 0.0000035 : 0.000000075;
    const outputCostPerToken = isRetry ? 0.0000105 : 0.00000030;
    const cost = ((usage.promptTokenCount * inputCostPerToken) + (usage.candidatesTokenCount * outputCostPerToken));

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((item: any) => {
          if (item.id) {
            const genreListToValidate = mode === 'missing_genre' ? MAIN_GENRE_TAGS : MICRO_GENRE_TAGS;

            resultsMap[item.id] = {
              vibe: validateTag(item.vibe, VIBE_TAGS),
              genre: validateTag(item.genre, genreListToValidate),
              situation: validateTag(item.situation, SITUATION_TAGS),
              year: (item.release_year || item.year || "0").toString(),
              hashtags: item.hashtags
            };
          }
        });
      }
    }

    // AUTO-RETRY LOGIC FOR MISSING YEARS
    // If we are in 'missing_year' mode AND this was the initial (Flash) run
    if (mode === 'missing_year' && !isRetry) {
        // Find tracks that failed to get a confident year
        const failedIds = tracks.filter(t => {
           const res = resultsMap[t.TrackID];
           // Retry if year is missing, "0", "Unknown", or if we got no result
           return !res || res.year === "0" || res.year === "" || res.year === "Unknown";
        }).map(t => t.TrackID);
        
        if (failedIds.length > 0) {
            // Filter tracks that need retry
            const retryTracks = tracks.filter(t => failedIds.includes(t.TrackID));
            
            // Recursive call with isRetry=true (triggers gemini-2.5-pro + grounding)
            const retryResult = await generateTagsBatch(retryTracks, mode, true);
            
            // Merge results: overwrite failures with new grounded results
            Object.assign(resultsMap, retryResult.results);
            
            // Merge Usage & Cost
            const totalCost = cost + retryResult.usage.cost;
            const totalInput = usage.promptTokenCount + retryResult.usage.inputTokens;
            const totalOutput = usage.candidatesTokenCount + retryResult.usage.outputTokens;
            
             return { 
                results: resultsMap, 
                usage: { 
                    inputTokens: totalInput, 
                    outputTokens: totalOutput, 
                    cost: totalCost 
                },
                error: undefined 
             };
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
