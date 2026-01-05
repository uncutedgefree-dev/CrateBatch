const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

function loadEnv() {
  const possiblePaths = [
    path.join(__dirname, '..', '.env'), // Development
    path.join(process.resourcesPath, '.env'), // Packaged (outside ASAR)
    path.join(app.getPath('userData'), '.env'), // User Data Folder
  ];

  for (const envPath of possiblePaths) {
    try {
      if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim();
            process.env[key.trim()] = value;
          }
        });
        console.log(`Loaded env from: ${envPath}`);
        break; // Stop after first successful load
      }
    } catch (e) {
      console.error(`Error loading env from ${envPath}:`, e);
    }
  }
}

// Load env before anything else
loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, title: "CrateBatch",
    webPreferences: { 
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true, 
      nodeIntegration: false 
    }
  });
  
  // In production, the dist/index.html is inside the asar
  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);

ipcMain.handle('READ_FILE', async (event, filePath) => {
  try { 
    return { success: true, data: fs.readFileSync(filePath, 'utf-8') }; 
  } catch (error) { 
    return { success: false, error: error.message }; 
  }
});

ipcMain.handle('ENRICH_BATCH', async (event, { tracks, prompt, apiKey }) => {
  if (!tracks || tracks.length === 0) return [];
  
  // Use the key passed from the UI (which is baked-in via Vite)
  // or fall back to the local .env key (for local dev)
  const finalKey = apiKey || process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  
  if (!finalKey) {
    return [{ success: false, error: "API Key Missing. Please check your GitHub Secrets or .env file." }];
  }

  const BATCH_SIZE = 50; 
  const results = [];
  
  const processSubBatch = async (subTracks) => {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${finalKey}`,
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
