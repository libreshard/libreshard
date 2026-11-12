// The only bridge between the desktop window and the main process. The page gets these functions
// and nothing else: no Node, no ipcRenderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('libreshard', {
  getState: invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onReview: (cb) => ipcRenderer.on('install:review', (_e, r) => cb(r)),

  setPaused: invoke('app:pause'),
  openPanel: invoke('panel:open'),
  openPath: invoke('app:open-path'),
  openLink: invoke('app:open-link'),
  copyDiagnostics: invoke('app:copy-diagnostics'),
  reportBug: invoke('app:report-bug'),
  checkUpdates: invoke('update:check'),
  dismissUpdate: invoke('update:dismiss'),
  restart: invoke('app:restart'),
  setSetting: invoke('settings:set'),

  renameDevice: invoke('device:rename'),
  removeDevice: invoke('device:remove'),

  pickInstall: invoke('install:pick'),
  prepareInstall: invoke('install:path'),
  confirmInstall: invoke('install:confirm'),
  cancelInstall: invoke('install:cancel'),
  // Dropped files only expose their path through webUtils in a sandboxed page
  pathForFile: (file) => webUtils.getPathForFile(file),

  approveShard: invoke('shard:approve'),
  setShardEnabled: invoke('shard:enable'),
  uninstallShard: invoke('shard:uninstall'),
  openShardFolder: invoke('shard:open'),

  listOpenApps: invoke('apps:open'),
  detectApp: invoke('apps:detect'),
  setShardApps: invoke('shard:set-apps'),
  resetShardApps: invoke('shard:reset-apps'),
  setShardSettings: invoke('shard:settings'),
  resetShardSettings: invoke('shard:reset-settings'),
  pickDevInstall: invoke('install:pick-dev'),
  setShardFavorite: invoke('shard:favorite'),
  moveShard: invoke('shard:move'),
});
