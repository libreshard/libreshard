const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { startServer } = require('./server');
const { Pairing, Devices, RateLimiter } = require('./pairing');
const { ShardStore } = require('./shard-store');
const { classifyKeys } = require('./manifest');
const installer = require('./installer');
const focus = require('./focus');
const { appLabel, isSelfApp } = require('./focus/apps');
const i18n = require('./i18n');
const { labelFor } = require('./shard-settings');

const DEFAULT_PORT = 7878;
const VPN = /tailscale|zerotier|hamachi|vpn|wireguard|openvpn|nord|proton/i;
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|vbox|loopback/i;
const DESKTOP_PAGE = path.join(__dirname, 'desktop', 'index.html');
const DESKTOP_URL = pathToFileURL(DESKTOP_PAGE).href;
const SHARD_FILE = /\.(libreshard|zip)$/i;

const dataFile = (name) => path.join(app.getPath('userData'), name);

// Settings in <userData>/config.json, with their defaults and validation
const SETTINGS = {
  port: { default: DEFAULT_PORT, valid: (v) => Number.isInteger(v) && v >= 1024 && v <= 65535 },
  allowPublicNetworks: { default: false, valid: (v) => typeof v === 'boolean' },
  confirmDevices: { default: false, valid: (v) => typeof v === 'boolean' },
  allowAppsFromTablet: { default: true, valid: (v) => typeof v === 'boolean' },
  closeToTray: { default: true, valid: (v) => typeof v === 'boolean' },
  openAtLogin: { default: false, valid: (v) => typeof v === 'boolean' },
  language: { default: 'auto', valid: (v) => v === 'auto' || i18n.languages.includes(v) },
};

function saveConfig(cfg) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataFile('config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

// Missing or invalid values are filled in and saved
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(dataFile('config.json'), 'utf8')) || {}; } catch { /* first run */ }
  let changed = false;
  for (const [key, s] of Object.entries(SETTINGS)) {
    if (!s.valid(cfg[key])) {
      cfg[key] = s.default;
      changed = true;
    }
  }
  if (changed) saveConfig(cfg);
  return cfg;
}

// Real interfaces (no virtual adapters), VPNs last
function lanInterfaces() {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([name, addrs]) =>
      addrs
        .filter((i) => i.family === 'IPv4' && !i.internal)
        .map((i) => ({ name, address: i.address, vpn: VPN.test(name) })))
    .sort((a, b) => a.vpn - b.vpn);
}

let win = null;
let server = null;
let pendingFile = null; // a .libreshard opened before the window was ready

// A second instance would fail to take the port: it focuses the open window instead, and hands over
// any shard file it was opened with (double-clicking a .libreshard while LibreShard runs)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    openShardFile(argv.find((a) => SHARD_FILE.test(a)));
  });
  app.on('open-file', (e, file) => { e.preventDefault(); openShardFile(file); }); // macOS
  app.whenReady().then(start);
}

// Before quitting, let go of every key a tablet is holding, so nothing stays pressed on the PC
let released = false;
let quitting = false; // set once the app is really quitting, so closing the window doesn't just hide it
app.on('before-quit', (e) => {
  quitting = true;
  if (released || !server) return;
  e.preventDefault();
  released = true;
  server.releaseAll().catch(() => {}).finally(() => app.quit());
});

let openShardFile = (file) => { if (file) pendingFile = file; };

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// "Open at login": Windows and macOS keep it in the OS; Linux uses an XDG autostart file. LibreShard
// then starts with --hidden (only the tray icon) when there is a tray.
function applyOpenAtLogin(on) {
  const launch = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  if (process.platform === 'linux') {
    const file = path.join(app.getPath('appData'), 'autostart', 'libreshard.desktop');
    if (!on) return fs.rmSync(file, { force: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const exec = [launch, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=LibreShard\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`);
  } else {
    app.setLoginItemSettings({ openAtLogin: on, path: launch, args });
  }
}

async function start() {
  const cfg = loadConfig();
  const started = { port: cfg.port, allowPublicNetworks: cfg.allowPublicNetworks };
  let locale = i18n.pickLocale(cfg.language, app.getLocale());
  let t = i18n.translator(locale);

  const userShards = dataFile('shards');
  fs.mkdirSync(userShards, { recursive: true });
  const rulesFile = dataFile('app-rules.json');
  if (!fs.existsSync(rulesFile)) fs.writeFileSync(rulesFile, '{}\n');

  const devices = new Devices(dataFile('devices.json'));
  const pairing = new Pairing();
  const store = new ShardStore({
    dirs: [{ dir: path.join(__dirname, 'shards'), bundled: true }, { dir: userShards, bundled: false }],
    installDir: userShards,
    stateFile: dataFile('shards-state.json'),
    rulesFile,
    appVersion: app.getVersion(),
    watch: true,
  });
  let alertAt = 0;

  // Optional confirmation of new devices, as a native dialog over the window
  async function askDevice({ name, ip }) {
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.flashFrame(true);
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [t('dialog.allow'), t('dialog.reject')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: t('dialog.confirmDevice.message', { name }),
      detail: t('dialog.confirmDevice.detail', { ip }),
    });
    win.flashFrame(false);
    return response === 0;
  }

  try {
    server = await startServer({
      port: cfg.port,
      store,
      devices,
      pairing,
      limiter: new RateLimiter(),
      allowPublic: cfg.allowPublicNetworks,
      onAlert: () => { alertAt = Date.now(); push(); },
      confirmPairing: (info) => (cfg.confirmDevices ? askDevice(info) : true),
      allowAppsFromTablet: () => cfg.allowAppsFromTablet,
      language: () => cfg.language,
    });
  } catch (e) {
    dialog.showErrorBox('LibreShard', e.code === 'EADDRINUSE'
      ? t('dialog.portInUse', { port: cfg.port, file: dataFile('config.json') })
      : t('dialog.serverFailed', { error: e.message }));
    app.quit();
    return;
  }

  const localUrl = () => `http://localhost:${cfg.port}/?pair=${pairing.current().token}`;

  // QR images only change when the pairing token does
  let qrCache = { token: null, list: [] };
  async function qrs(token) {
    if (qrCache.token !== token) {
      const list = await Promise.all(lanInterfaces().map(async (i) => {
        const url = `http://${i.address}:${cfg.port}`;
        return { name: i.name, vpn: i.vpn, url, dataUrl: await QRCode.toDataURL(`${url}/?pair=${token}`, { margin: 1, width: 180 }) };
      }));
      qrCache = { token, list };
    }
    return qrCache.list;
  }

  // Program icons for the apps editor, read once per executable path
  const icons = new Map();
  async function iconFor(p) {
    if (!p) return null;
    if (!icons.has(p)) {
      icons.set(p, await app.getFileIcon(p, { size: 'normal' }).then((img) => img.toDataURL()).catch(() => null));
    }
    return icons.get(p);
  }
  const withIcons = (apps) => Promise.all(apps.map(async (a) => ({ ...a, icon: await iconFor(a.path) })));

  async function buildState() {
    const { code, token, expiresAt } = pairing.current();
    return {
      now: Date.now(),
      version: app.getVersion(),
      locale,
      strings: i18n.strings(locale),
      paused: server.isPaused(),
      alertAt,
      restartNeeded: cfg.port !== started.port || cfg.allowPublicNetworks !== started.allowPublicNetworks,
      pairing: { code, expiresAt, qrs: await qrs(token) },
      devices: devices.all(),
      shards: await Promise.all(store.all().map(async (e) => ({
        id: e.id, name: e.manifest.name, author: e.manifest.author, version: e.manifest.version,
        icon: e.manifest.icon, description: e.manifest.description, keys: e.manifest.keys,
        bundled: e.bundled, linked: e.linked, enabled: e.enabled, apps: e.apps.map(appLabel),
        appEntries: await withIcons(e.apps), customApps: e.customApps, suggestedApps: e.suggestedApps,
        settings: e.settings, favorite: store.isFavorite(e.id),
        settingsSchema: e.manifest.settings.map((item) => ({
          ...item,
          label: labelFor(item.label, locale),
          options: item.options && item.options.map((o) => ({ value: o.value, label: labelFor(o.label, locale) })),
        })),
        pendingKeys: e.pendingKeys, risk: classifyKeys(e.manifest.keys),
      }))),
      detection: focus.providerName(),
      rejected: store.rejected.map((r) => ({ folder: path.basename(r.root), root: r.root, errors: r.errors })),
      settings: {
        port: cfg.port, allowPublicNetworks: cfg.allowPublicNetworks, confirmDevices: cfg.confirmDevices,
        allowAppsFromTablet: cfg.allowAppsFromTablet, language: cfg.language,
        closeToTray: cfg.closeToTray, openAtLogin: cfg.openAtLogin,
      },
    };
  }

  // Sends the whole state to the window, at most once per tick
  let pushTimer = null;
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (win && !win.isDestroyed()) win.webContents.send('state', await buildState());
    }, 30);
  }
  store.on('change', push);
  store.on('settings', push);
  devices.on('change', push);
  pairing.on('change', push);

  /* ---------- Installing ---------- */

  // Prepared installs waiting for the user's confirmation, by a random id
  const candidates = new Map();
  // link: development mode, where the folder is linked instead of copied
  async function prepareInstall(source, { link = false } = {}) {
    if (link && !fs.statSync(source).isDirectory()) throw new Error('Development mode needs a folder');
    const r = await installer.prepare(source, {
      appVersion: app.getVersion(),
      existing: link ? undefined : (id) => store.all().find((e) => e.id === id),
    });
    if (!r.ok) return { ok: false, errors: r.errors };
    const id = crypto.randomUUID();
    candidates.set(id, { ...r, link });
    return { ok: true, review: { id, link, manifest: r.manifest, risk: r.risk, size: r.size, update: r.update } };
  }

  openShardFile = async (file) => {
    if (!file || !fs.existsSync(file)) return;
    const r = await prepareInstall(file);
    if (r.ok) win.webContents.send('install:review', r.review);
    else dialog.showErrorBox('LibreShard', r.errors.join('\n'));
  };

  /* ---------- IPC: only the desktop page may call, and every argument is checked ---------- */

  function handle(channel, fn) {
    ipcMain.handle(channel, async (e, ...args) => {
      if (!win || e.sender !== win.webContents || e.senderFrame?.url !== DESKTOP_URL) throw new Error('Not allowed');
      try {
        return (await fn(...args)) ?? { ok: true };
      } catch (err) {
        return { ok: false, errors: [err.message] };
      }
    });
  }
  const entry = (id) => {
    const e = store.all().find((x) => x.id === id);
    if (!e) throw new Error('Unknown shard');
    return e;
  };
  const confirmBox = async (message, detail, button) => (await dialog.showMessageBox(win, {
    type: 'warning', buttons: [button, t('action.cancel')], defaultId: 1, cancelId: 1, noLink: true, message, detail,
  })).response === 0;

  handle('state:get', buildState);
  handle('app:pause', async (on) => { await server.setPaused(on === true); updateTray(); push(); });
  handle('app:open-viewer', () => { shell.openExternal(localUrl()); });
  handle('app:open-path', (kind, p) => {
    if (kind === 'shards') shell.openPath(userShards);
    else if (kind === 'data') shell.openPath(app.getPath('userData'));
    else if (kind === 'shard' && store.rejected.some((r) => r.root === p)) shell.openPath(p);
  });
  handle('app:restart', () => { app.relaunch(); app.quit(); });

  handle('settings:set', (key, value) => {
    const s = SETTINGS[key];
    if (!s || !s.valid(value)) throw new Error('Invalid value');
    cfg[key] = value;
    saveConfig(cfg);
    if (key === 'language') {
      locale = i18n.pickLocale(value, app.getLocale());
      t = i18n.translator(locale);
      updateTray();
    }
    if (key === 'openAtLogin') applyOpenAtLogin(value);
    push();
  });

  handle('device:rename', (id, name) => {
    if (typeof id !== 'string' || typeof name !== 'string') throw new Error('Invalid device');
    devices.rename(id, name);
  });
  handle('device:remove', async (id) => {
    const d = devices.all().find((x) => x.id === id);
    if (!d) throw new Error('Unknown device');
    if (await confirmBox(t('dialog.removeDevice.message', { name: d.name }), t('dialog.removeDevice.detail'), t('dialog.remove'))) devices.remove(id);
  });

  handle('install:pick', async (kind) => {
    const r = await dialog.showOpenDialog(win, kind === 'folder'
      ? { title: t('dialog.pickFolder'), properties: ['openDirectory'] }
      : { title: t('dialog.pickZip'), properties: ['openFile'], filters: [{ name: t('dialog.zipFilter'), extensions: ['zip', 'libreshard'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: true };
    return prepareInstall(r.filePaths[0]);
  });
  handle('install:path', (p, opts) => {
    if (typeof p !== 'string' || !p || !fs.existsSync(p)) throw new Error('File not found');
    return prepareInstall(p, { link: opts?.link === true });
  });
  handle('install:pick-dev', async () => {
    const r = await dialog.showOpenDialog(win, { title: t('dialog.pickDevFolder'), properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true };
    return prepareInstall(r.filePaths[0], { link: true });
  });
  handle('install:confirm', (id) => {
    const c = candidates.get(id);
    if (!c) throw new Error('This install is no longer available; pick the shard again');
    candidates.delete(id);
    try {
      if (c.link) store.link(c.root, c.manifest); else store.install(c.root, c.manifest);
    } finally { c.cleanup(); }
  });
  handle('install:cancel', (id) => {
    const c = candidates.get(id);
    if (c) { c.cleanup(); candidates.delete(id); }
  });

  handle('shard:approve', (id) => { store.approve(entry(id).id); });
  handle('shard:enable', (id, on) => { store.setEnabled(entry(id).id, on === true); });
  handle('shard:open', (id) => { shell.openPath(entry(id).root); });

  // Apps editor. LibreShard itself is never offered: the user is looking at it while choosing.
  handle('apps:open', async () => {
    const list = await focus.openApps();
    if (!list) return { ok: true, apps: null };
    return { ok: true, apps: await withIcons(list.filter((a) => !isSelfApp(a))) };
  });
  handle('apps:detect', async () => {
    const a = await focus.active();
    if (!a) throw new Error(t('apps.detectFailed'));
    if (isSelfApp(a)) throw new Error(t('apps.detectSelf'));
    const found = a.exe ? { exe: a.exe, name: a.name || a.exe, path: a.path } : { match: a.title.slice(0, 100) };
    return { ok: true, app: (await withIcons([found]))[0] };
  });
  handle('shard:set-apps', (id, rule) => { store.setRule(entry(id).id, rule); });
  handle('shard:reset-apps', (id) => { store.resetRule(entry(id).id); });
  handle('shard:settings', (id, values) => { store.setSettings(entry(id).id, values); });
  handle('shard:favorite', (id, on) => { store.setFavorite(entry(id).id, on === true); });
  handle('shard:move', (id, direction) => { store.move(entry(id).id, direction); });
  handle('shard:reset-settings', (id) => { store.resetSettings(entry(id).id); });
  handle('shard:uninstall', async (id) => {
    const e = entry(id);
    if (e.bundled) throw new Error('Bundled shards can be disabled, not uninstalled');
    const detail = e.linked ? t('dialog.uninstall.detailLinked') : t('dialog.uninstall.detail');
    if (await confirmBox(t('dialog.uninstall.message', { name: e.manifest.name || e.id }), detail, t('dialog.uninstallButton'))) store.uninstall(e.id);
  });

  /* ---------- Tray ---------- */

  // The tray keeps LibreShard (and the server) running with the window closed. Some Linux desktops
  // have no tray; then closing the window quits as before.
  let tray = null;
  function updateTray() {
    if (!tray) return;
    tray.setToolTip(server.isPaused() ? `LibreShard · ${t('status.paused')}` : 'LibreShard');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('tray.open'), click: showWindow },
      { label: server.isPaused() ? t('action.resume') : t('action.pause'), click: () => togglePause() },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => app.quit() },
    ]));
  }
  async function togglePause() {
    await server.setPaused(!server.isPaused());
    updateTray();
    push();
  }
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'viewer', 'brand', 'icon-192.png'));
    tray = new Tray(icon.resize({ width: process.platform === 'darwin' ? 18 : 32 }));
    tray.on('click', showWindow); // Windows; on Linux the menu opens instead
    updateTray();
  } catch (e) {
    console.warn('No system tray:', e.message);
    tray = null;
  }

  /* ---------- Window ---------- */

  const startHidden = process.argv.includes('--hidden') && !!tray;
  win = new BrowserWindow({
    show: !startHidden,
    width: 860, height: 780, minWidth: 620, minHeight: 520, autoHideMenuBar: true, title: 'LibreShard',
    backgroundColor: '#0d1b2a', icon: path.join(__dirname, 'viewer', 'brand', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'desktop', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // The page never navigates or opens windows; links to the viewer go through shell.openExternal
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => {
    const file = pendingFile || process.argv.slice(1).find((a) => SHARD_FILE.test(a));
    pendingFile = null;
    openShardFile(file);
  });
  // With a tray, closing the window only hides it (the tablets keep working); the first time, say so
  let hintShown = false;
  win.on('close', (e) => {
    if (quitting || !tray || !cfg.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!hintShown && Notification.isSupported()) {
      hintShown = true;
      new Notification({ title: 'LibreShard', body: t('tray.stillRunning') }).show();
    }
  });
  win.loadFile(DESKTOP_PAGE);
}

app.on('window-all-closed', () => app.quit());
