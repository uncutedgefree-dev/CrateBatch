const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  readFile: (filePath) => ipcRenderer.invoke('READ_FILE', filePath),
  saveFile: (data) => ipcRenderer.invoke('SAVE_FILE', data),
  enrichBatch: (payload) => ipcRenderer.invoke('ENRICH_BATCH', payload)
});
