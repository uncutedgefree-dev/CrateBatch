const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");

exports.enrichBatch = onRequest({ 
  cors: true,
  timeoutSeconds: 300,
  memory: "512Mi",
  // IMPORTANT: This tells Firebase to inject the secret into this specific function
  secrets: ["GEMINI_API_KEY"] 
}, async (request, response) => {
  try {
    const { tracks, prompt } = request.body;
    
    // In Gen2 Functions, secrets are accessed via process.env just like standard env vars
    // BUT they must be declared in the secrets array above!
    const apiKey = process.env.GEMINI_API_KEY;

    if (!tracks || !prompt || !apiKey) {
      response.status(400).send({ 
        error: !apiKey ? "Server Key Missing (Secrets Not Injected)" : "Missing tracks or prompt" 
      });
      return;
    }

    // Process using the secure key
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt + "\n\nTracks:\n" + JSON.stringify(tracks) }] }],
        generationConfig: { 
          response_mime_type: "application/json",
          temperature: 0.1
        }
      },
      { timeout: 300000 }
    );

    response.status(200).send({ 
      success: true, 
      data: aiResponse.data 
    });

  } catch (error) {
    logger.error("Batch AI Error", error.message);
    const status = error.response ? error.response.status : 500;
    const msg = error.response?.data?.error?.message || error.message;
    response.status(status).send({ success: false, error: msg });
  }
});
