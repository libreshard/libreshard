// Preload of the local panel window ("This PC"). It hands the viewer its device token, once, before
// the viewer's own script runs.
const { contextBridge, ipcRenderer } = require('electron');

const token = ipcRenderer.sendSync('panel:token');
if (token) localStorage.setItem('device-token', token);

// Linux: the panel window has no frame (see openPanel in main.js), so the viewer draws its own bar.
// These are the only things it can ask for; the main process takes positions from the real cursor.
// Shards can't reach this: the preload only runs in the top frame, and they live in sandboxed iframes.
if (process.platform === 'linux') {
  contextBridge.exposeInMainWorld('libreshardPanel', {
    gesture: (kind, phase) => ipcRenderer.send('panel:gesture', kind, phase),
    close: () => ipcRenderer.send('panel:close'),
  });
}
