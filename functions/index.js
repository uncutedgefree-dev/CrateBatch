const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");

// API Key - Will look for environment variable if available
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCdZ3qzImjGv6vXh0_llLpxEroQ_Mu_ufM';

// STRICTLY LOCKED TO GEMINI-3-FLASH
const MODEL_NAME = "gemini-3-flash"; 

exports.enrichTrack = onRequest({ cors: true }, async (request, response) => {
  try {
    const { track, prompt } = request.body;

    if (!track || !prompt) {
      response.status(400).send({ error: "Missing track or prompt data" });
      return;
    }

    // Switched to v1 and Locked to gemini-3-flash
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(track) }] }],
        generationConfig: { 
          response_mime_type: "application/json",
          temperature: 0.1
        }
      },
      { timeout: 120000 }
    );

    response.status(200).send({ 
      success: true, 
      data: aiResponse.data 
    });

  } catch (error) {
    logger.error("AI Enrichment Error", error.message);
    
    const status = error.response ? error.response.status : 500;
    const msg = error.response?.data?.error?.message || error.message;

    response.status(status).send({ 
      success: false, 
      error: msg 
    });
  }
});
