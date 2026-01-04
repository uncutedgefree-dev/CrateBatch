const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const fs = require('fs');

// 🔒 THE VAULT: Hardcoded API Key for Desktop App
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
      nodeIntegration: false, // Security best practice
    },
  });

  // Load the built app in production or localhost in dev
  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------------------------------------------------------
//  THE UNLIMITED POWER ENGINE (IPC HANDLERS)
// ---------------------------------------------------------

// 1. FILE SYSTEM: Read the XML file directly from disk
ipcMain.handle('READ_FILE', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 2. FILE SYSTEM: Save the enriched XML back to disk
ipcMain.handle('SAVE_FILE', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 3. ENRICHMENT: The "Fan-Out" Engine
// Receives a batch of tracks and processes them in parallel (Limited concurrency)
ipcMain.handle('ENRICH_BATCH', async (event, { tracks, prompt }) => {
  if (!tracks || tracks.length === 0) return [];

  const limit = pLimit(50); // Run 50 requests in parallel

  const tasks = tracks.map((track) => limit(async () => {
    try {
      // Direct call to Gemini API using Axios (Bypasses Browser Limits)
      // Uses the hardcoded MOZART_API_KEY
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${MOZART_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(track) }] }],
          generationConfig: { response_mime_type: "application/json" }
        },
        { timeout: 120000 } // 2 minute timeout
      );
      
      // Handle ID mapping safely
      const trackId = track.id || track.TrackID || track.ID;

      return { id: trackId, data: response.data, success: true };
    } catch (err) {
      const trackId = track.id || track.TrackID || track.ID;
      console.error(`Error processing track ${trackId}:`, err.message);
      return { id: trackId, error: err.message, success: false };
    }
  }));

  // Wait for all tasks to complete
  return await Promise.all(tasks);
});
