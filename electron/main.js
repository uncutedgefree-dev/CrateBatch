const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const fs = require('fs');

// 🔒 THE VAULT: Hardcoded API Key
const MOZART_API_KEY = 'AIzaSyD3UA7hHSrowzF-fEXTmQoPBOZJ8HZje_c';

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

  const limit = pLimit(50); // High concurrency for Flash

  const tasks = tracks.map((track) => limit(async () => {
    try {
      // Using gemini-3-flash as confirmed available
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${MOZART_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(track) }] }],
          generationConfig: { 
            response_mime_type: "application/json",
            temperature: 0.1 // Lower temperature for more consistent tagging
          }
        },
        { timeout: 120000 }
      );
      
      const trackId = track.id || track.TrackID || track.ID;
      return { id: trackId, data: response.data, success: true };
    } catch (err) {
      const trackId = track.id || track.TrackID || track.ID;
      console.error(`Error processing track ${trackId}:`, err.message);
      return { id: trackId, error: err.message, success: false };
    }
  }));

  return await Promise.all(tasks);
});
