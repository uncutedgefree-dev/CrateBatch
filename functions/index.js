const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Explicitly using the requested preview model
    const modelName = "gemini-3-flash-preview";
    
    const model = genAI.getGenerativeModel({ 
      model: modelName, 
      generationConfig: { responseMimeType: "application/json" } 
    });

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
    logger.error(`Batch AI Error (${process.env.GEMINI_API_KEY ? 'Key Present' : 'Key Missing'})`, error);
    
    const msg = error.message || "Unknown Error";
    response.status(500).send({ 
      success: false, 
      error: msg.includes("404") ? `Model '${modelName}' not found or not accessible.` : msg 
    });
  }
});
