const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

// Since we are using the Cloud Function proxy, we don't need local AI processing in the main process anymore.
// However, we keep the IPC structure in case we want to move logic back to the main process later.
ipcMain.handle('ENRICH_BATCH', async (event, payload) => {
   return { success: false, error: "This function is deprecated. Please use the Cloud Function proxy." };
});
