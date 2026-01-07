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
        prompt: prompt, // Sending prompt explicitly in case backend uses it directly
        model: "gemini-3-pro-preview"
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

  const currentYear = new Date().getFullYear();
  let systemInstruction = `You are an expert music librarian. The current year is ${currentYear}.
Task: Analyze the provided list of tracks.`;

  if (mode === 'missing_year') {
    systemInstruction += `\nRules:
1. Identify the ORIGINAL release year for each track based on the Artist and Title.
2. CRITICAL: Identify if the track is a "Utility Edit" (DJ Intro, Redrum, Club Edit, Extended Mix, Clean, Dirty).
3. FOR UTILITY EDITS: You MUST return the ORIGINAL song release year, NOT the year the edit was uploaded to the record pool.
   - Example: "50 Cent - In Da Club (DJCity Intro)" -> Return "2003" (Original), NOT "2023" (Pool Upload).
   - Example: "Earth, Wind & Fire - September (BPM Supreme Redrum)" -> Return "1978".
4. ONLY return a newer year if the track is a distinct **OFFICIAL REMIX** or **COVER** by a different artist that changes the era.
   - Example: "Tracy Chapman - Fast Car (Jonas Blue Remix)" -> Return "2015".
   - Example: "Luke Combs - Fast Car" -> Return "2023".
5. Ignore labels like "Intro", "Dirty", "Clean", "Hype" when identifying the core song.
6. STRICTLY NO GUESSING. If you do not know the track or are unsure, return "0".
7. Valid Range: 1950-${currentYear}.
Return JSON: [{"id": "...", "release_year": "..."}]`;
  } else if (mode === 'missing_genre') {
    // UPDATED INSTRUCTION FOR MISSING GENRE MODE
    systemInstruction += `\nRules:
1. Identify the BROAD MAIN GENRE for the track.
2. Use ONLY these Broad Genres: ${MAIN_GENRE_TAGS.join(', ')}
3. Return JSON: [{"id": "...", "genre": "..."}]`;
  } else {
    // UPDATED INSTRUCTION FOR FULL MODE
    systemInstruction += `\nRules:
1. Identify ORIGINAL release year.
2. Use ONLY tags provided.
3. STRICTLY IGNORE BPM when determining Genre. A Hip Hop track at 80BPM is NOT R&B.
4. "R&B" is for Rhythm & Blues, Neo-Soul, or Slow Jams. Rap/Trap verses = Hip Hop.
5. AVOID BROAD GENRES like "Hip Hop", "Pop", "Rock", "Electronic", "Dance" if a more specific micro-genre applies.
6. Use "Trap", "Boom Bap", "Drill", "Grime" for Hip-Hop subgenres.
7. Use "Contemporary R&B", "New Jack Swing", "Neo Soul" for R&B subgenres.
8. If the Artist is a Rapper, default to "Trap" or "Boom Bap" depending on the era/style, unless it is clearly an R&B crossover.
VIBES: ${VIBE_TAGS.join(', ')}
GENRES: ${MICRO_GENRE_TAGS.join(', ')}
SITUATIONS: ${SITUATION_TAGS.join(', ')}
Return JSON: [{"id": "...", "vibe": "...", "genre": "...", "situation": "...", "release_year": "...", "hashtags": "#Genre #Vibe #Situation"}]`;
  }

  try {
    // ALWAYS USE PRO MODEL
    const model = "gemini-3-pro-preview";
    
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tracks: tracksPayload, 
        prompt: systemInstruction,
        model: model 
      })
    });

    const res = await response.json();
    if (!res.success) throw new Error(res.error || "Proxy Error");

    const resultsMap: Record<string, AIAnalysis> = {};
    const usage = res.data.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
    
    // Cost estimation for Pro model
    const inputCostPerToken = 0.0000035;
    const outputCostPerToken = 0.0000105;
    const cost = ((usage.promptTokenCount * inputCostPerToken) + (usage.candidatesTokenCount * outputCostPerToken));

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((item: any) => {
          if (item.id) {
            // Determine which genre set to validate against
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

    return { 
      results: resultsMap, 
      usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, cost },
      error: Object.keys(resultsMap).length === 0 ? "No data returned" : undefined 
    };
  } catch (e: any) {
    return { results: {}, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, error: e.message };
  }
};
