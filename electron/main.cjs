const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf-8');
      envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) process.env[key.trim()] = value.trim();
      });
    }
  } catch (e) {}
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, title: "CrateBatch",
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);

ipcMain.handle('READ_FILE', async (event, filePath) => {
  try { return { success: true, data: fs.readFileSync(filePath, 'utf-8') }; }
  catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('ENRICH_BATCH', async (event, { tracks, prompt }) => {
  if (!tracks || tracks.length === 0) return [];
  if (!GEMINI_API_KEY) return [{ success: false, error: "API Key Missing" }];

  const BATCH_SIZE = 50; 
  const results = [];
  
  const processSubBatch = async (subTracks) => {
    try {
      // Using gemini-3-flash-preview as requested. 
      // Increased timeout to 5 minutes to handle large batches and potential API congestion.
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt + "\n\nTracks to analyze:\n" + JSON.stringify(subTracks) }] }],
          generationConfig: { 
            response_mime_type: "application/json", 
            temperature: 0.1 
          }
        },
        { timeout: 300000 }
      );
      return { success: true, data: response.data };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      return { success: false, error: msg };
    }
  };

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const subBatch = tracks.slice(i, i + BATCH_SIZE);
    const result = await processSubBatch(subBatch);
    results.push(result);
  }

  return results;
});
