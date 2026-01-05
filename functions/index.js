const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");

// 🔒 THE VAULT: API Key stored securely on the server
const MOZART_API_KEY = 'AIzaSyD3UA7hHSrowzF-fEXTmQoPBOZJ8HZje_c';

// NOTE: Switched to gemini-1.5-flash as gemini-3-flash is not a valid public model ID.
const MODEL_NAME = "gemini-1.5-flash"; 

exports.enrichTrack = onRequest({ cors: true }, async (request, response) => {
  try {
    const { track, prompt } = request.body;

    if (!track || !prompt) {
      response.status(400).send({ error: "Missing track or prompt data" });
      return;
    }

    // Call Google Generative AI
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${MOZART_API_KEY}`,
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
