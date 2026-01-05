const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

// ---------------------------------------------------------
//  ENV LOADER
// ---------------------------------------------------------
if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf-8');
      envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      });
      console.log('[Main] Loaded configuration from .env file');
    }
  } catch (e) {
    console.log('[Main] No .env file found');
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "CrateBatch",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('READ_FILE', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('SAVE_FILE', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ENRICH_BATCH', async (event, { tracks, prompt }) => {
  if (!tracks || tracks.length === 0) return [];
  
  if (!GEMINI_API_KEY) {
    console.error("CRITICAL: GEMINI_API_KEY is missing.");
    return tracks.map(t => ({ id: t.id, success: false, error: "API Key Missing" }));
  }

  const CONCURRENCY = 20; 
  const results = [];
  
  const processTrack = async (track) => {
    try {
      // Switched to v1 endpoint and keeping gemini-3-flash
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-3-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(track) }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
        },
        { timeout: 60000 }
      );
      
      const trackId = track.id || track.TrackID || track.ID;
      return { id: trackId, data: response.data, success: true };
    } catch (err) {
      const trackId = track.id || track.TrackID || track.ID;
      const errMsg = err.response?.data?.error?.message || err.message;
      return { id: trackId, error: errMsg, success: false };
    }
  };

  for (let i = 0; i < tracks.length; i += CONCURRENCY) {
    const batch = tracks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processTrack));
    results.push(...batchResults);
  }

  return results;
});
