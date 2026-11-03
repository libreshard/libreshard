// Preload of the local panel window ("This PC"). It hands the viewer its device token, once, before
// the viewer's own script runs. Nothing is exposed to the page.
const { ipcRenderer } = require('electron');

const token = ipcRenderer.sendSync('panel:token');
if (token) localStorage.setItem('device-token', token);
