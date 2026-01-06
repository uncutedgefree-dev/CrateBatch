const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper to get initialized model
const getModel = (apiKey) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });
};

exports.enrichBatch = onRequest({ 
  cors: true,
  timeoutSeconds: 540,
  memory: "1GiB",
  secrets: ["GEMINI_API_KEY"] 
}, async (request, response) => {
  try {
    const { tracks, prompt } = request.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!tracks || !prompt || !apiKey) {
      response.status(400).send({ 
        error: !apiKey ? "Server Key Missing" : "Missing tracks or prompt" 
      });
      return;
    }

    const model = getModel(apiKey);
    const result = await model.generateContent(prompt + "\n\nTracks:\n" + JSON.stringify(tracks));
    const aiResponse = await result.response;
    const text = aiResponse.text();

    response.status(200).send({ 
      success: true, 
      data: {
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: aiResponse.usageMetadata
      }
    });

  } catch (error) {
    logger.error(`Batch AI Error`, error);
    const msg = error.message || "Unknown Error";
    response.status(500).send({ success: false, error: msg });
  }
});

// New Function: Semantic Search / Playlist Generator
exports.generatePlaylist = onRequest({ 
  cors: true,
  timeoutSeconds: 60,
  memory: "512Mi",
  secrets: ["GEMINI_API_KEY"] 
}, async (request, response) => {
  try {
    const { query, taxonomy, prompt: customPrompt } = request.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!query || !apiKey) {
      response.status(400).send({ error: "Missing query or API key" });
      return;
    }

    const model = getModel(apiKey);
    
    // Prompt to convert natural language into structured filters
    // Use customPrompt from client if available (allows frontend iteration)
    const prompt = customPrompt || `
      You are an expert DJ music librarian.
      User Query: "${query}"
      
      Your goal is to translate this request into a structured JSON filter object.
      
      Available Taxonomy:
      Vibes: ${JSON.stringify(taxonomy.vibes)}
      Genres: ${JSON.stringify(taxonomy.genres)}
      Situations: ${JSON.stringify(taxonomy.situations)}
      
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

    const result = await model.generateContent(prompt);
    const aiResponse = await result.response;
    const text = aiResponse.text();

    response.status(200).send({ 
      success: true, 
      data: JSON.parse(text) 
    });

  } catch (error) {
    logger.error("Playlist Gen Error", error);
    response.status(500).send({ success: false, error: error.message });
  }
});
