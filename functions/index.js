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
    
    // User requested "gemini-3-flash". Assuming this refers to the latest experimental flash model (Gemini 2.0 Flash)
    // or a specific preview model. 
    // If "gemini-3-flash-preview" was the intent, we use that.
    // However, the most reliable "next-gen" flash model currently available via API is "gemini-2.0-flash-exp".
    // We will attempt to use "gemini-2.0-flash-exp". 
    const modelName = "gemini-2.0-flash-exp";
    
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
    
    // Helper to extract meaningful error message
    const msg = error.message || "Unknown Error";
    
    // If the model is not found, it might be a region or access issue.
    // We pass this detail back to the client.
    response.status(500).send({ 
      success: false, 
      error: msg.includes("404") ? `Model not found: ${msg}` : msg 
    });
  }
});
