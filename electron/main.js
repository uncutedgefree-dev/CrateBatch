const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

// 🔑 PASTE YOUR GEMINI API KEY BELOW
// Get one here: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = 'AIzaSyCdZ3qzImjGv6vXh0_llLpxEroQ_Mu_ufM'; 

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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------
//  IPC HANDLERS
// ---------------------------------------------------------

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
  console.log(`[Main] Received ENRICH_BATCH with ${tracks?.length} tracks`);
  if (!tracks || tracks.length === 0) return [];

  const CONCURRENCY = 50;
  const results = [];
  
  const processTrack = async (track) => {
    try {
      // Using gemini-3-flash as requested
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(track) }] }],
          generationConfig: { 
            response_mime_type: "application/json",
            temperature: 0.1
          }
        },
        { timeout: 120000 }
      );
      
      const trackId = track.id || track.TrackID || track.ID;
      return { id: trackId, data: response.data, success: true };

    } catch (err) {
      const trackId = track.id || track.TrackID || track.ID;
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error(`[Main] Error processing track ${trackId}:`, errMsg);
      return { id: trackId, error: errMsg, success: false };
    }
  };

  // Process in chunks to limit concurrency
  for (let i = 0; i < tracks.length; i += CONCURRENCY) {
    const batch = tracks.slice(i, i + CONCURRENCY);
    console.log(`[Main] Processing batch subset ${i/CONCURRENCY + 1} of ${Math.ceil(tracks.length/CONCURRENCY)}`);
    const batchResults = await Promise.all(batch.map(processTrack));
    results.push(...batchResults);
  }

  return results;
});
