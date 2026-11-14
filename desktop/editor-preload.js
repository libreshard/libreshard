// The only bridge between the panel editor and the main process: these functions and nothing else
// (no Node, no ipcRenderer). The main process answers them only for the editor window.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('libreshardEditor', {
  init: invoke('editor:init'),
  check: invoke('editor:check'),
  setDirty: invoke('editor:dirty'),
  save: invoke('editor:save'),
  close: invoke('editor:close'),
});
