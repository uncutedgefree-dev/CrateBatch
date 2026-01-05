const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");

// This function will be called from CrateBatch
// We use the environment variable set in Firebase (NOT baked into the desktop app)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

exports.enrichBatch = onRequest({ 
  cors: true,
  timeoutSeconds: 300,
  memory: "512Mi"
}, async (request, response) => {
  try {
    const { tracks, prompt } = request.body;

    if (!tracks || !prompt || !GEMINI_API_KEY) {
      response.status(400).send({ 
        error: !GEMINI_API_KEY ? "Server Key Missing" : "Missing tracks or prompt" 
      });
      return;
    }

    // Process using the secure key
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
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
