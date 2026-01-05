const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const fs = require('fs');

// 🔒 THE VAULT: API Key (Temporary Local Fallback)
// Since Firebase deployment requires authentication, we will use the key directly here 
// so you can use the app immediately. 
// Once you successfully 'firebase deploy', switch this back to the FIREBASE_FUNCTION_URL.
const MOZART_API_KEY = 'AIzaSyCdZ3qzImjGv6vXh0_llLpxEroQ_Mu_ufM';

// const FIREBASE_FUNCTION_URL = "https://us-central1-cratetool.cloudfunctions.net/enrichTrack"; 

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
  if (!tracks || tracks.length === 0) return [];

  const limit = pLimit(50); 

  const tasks = tracks.map((track) => limit(async () => {
    try {
      // DIRECT GOOGLE API CALL (Fallback)
      // Using gemini-1.5-flash
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${MOZART_API_KEY}`,
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
      console.error(`Error processing track ${trackId}:`, errMsg);
      return { id: trackId, error: errMsg, success: false };
    }
  }));

  return await Promise.all(tasks);
});
