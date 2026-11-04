const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, screen, session, shell } = require('electron');
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
const PANEL_MIN = { width: 360, height: 280 };
// Windows never makes a window that doesn't activate topmost at Electron's default 'floating' level
// (checked with a game in front, 2026-11-04); an explicit level does
const PANEL_TOP_LEVEL = 'pop-up-menu';

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
  panelAlwaysOnTop: { default: false, valid: (v) => typeof v === 'boolean' },
  // Where the local panel window was last left; saved by the app, never set from the page
  panelBounds: {
    default: null, internal: true,
    valid: (v) => v === null || (!!v && typeof v === 'object' && ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(v[k])) && v.width >= 200 && v.height >= 150),
  },
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

// Linux: Chromium encrypts its cookie store with a key kept in the desktop keyring. The panel's web
// page wakes that up, and where the keyring is locked (automatic login) GNOME asks to create one,
// without saying which app wants it. LibreShard keeps no secrets in Chromium's storage (the panel's
// token lives in localStorage, which that key never covers), so the keyring isn't used at all.
// Revisit if secrets ever go through safeStorage, which relies on the same keyring.
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');

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
      platform: process.platform,
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
        closeToTray: cfg.closeToTray, openAtLogin: cfg.openAtLogin, panelAlwaysOnTop: cfg.panelAlwaysOnTop,
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
  handle('panel:open', () => { openPanel(); });
  handle('app:open-path', (kind, p) => {
    if (kind === 'shards') shell.openPath(userShards);
    else if (kind === 'data') shell.openPath(app.getPath('userData'));
    else if (kind === 'shard' && store.rejected.some((r) => r.root === p)) shell.openPath(p);
  });
  handle('app:restart', () => { app.relaunch(); app.quit(); });

  handle('settings:set', (key, value) => {
    const s = SETTINGS[key];
    if (!s || s.internal || !s.valid(value)) throw new Error('Invalid value');
    cfg[key] = value;
    saveConfig(cfg);
    if (key === 'language') {
      locale = i18n.pickLocale(value, app.getLocale());
      t = i18n.translator(locale);
      updateTray();
    }
    if (key === 'openAtLogin') applyOpenAtLogin(value);
    if (key === 'panelAlwaysOnTop' && panel) panel.setAlwaysOnTop(value, PANEL_TOP_LEVEL);
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

  /* ---------- Local panel ("This PC") ---------- */

  // For a touch screen on this PC: the viewer in its own window that never takes the focus, so the
  // keys still land in the app in front (WS_EX_NOACTIVATE on Windows, a non-activating panel on
  // macOS). It signs in as the single local device, created anew each time the window opens: only
  // token hashes are stored, so an old token can't be handed out again.
  let panel = null;
  let panelToken = null; // given once to the panel's preload, then forgotten
  const panelOrigin = () => `http://localhost:${cfg.port}`;
  const panelSession = session.fromPartition('persist:panel');
  // The viewer may only go full screen (the panel's own window); everything else is refused
  panelSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  panelSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');

  const fromPanel = (e) => !!panel && e.sender === panel.webContents && !!e.senderFrame?.url.startsWith(panelOrigin() + '/');
  ipcMain.on('panel:token', (e) => {
    const ok = fromPanel(e);
    e.returnValue = ok ? panelToken : null;
    if (ok) panelToken = null;
  });

  // Linux: the panel has no frame (see openPanel), so the viewer draws a bar that moves, resizes and
  // closes it through these messages. Positions come from the real cursor, never from the page.
  let gesture = null; // { kind, cursor, bounds } while a drag or resize is going on
  ipcMain.on('panel:gesture', (e, kind, phase) => {
    if (!fromPanel(e) || !['move', 'resize'].includes(kind) || !['start', 'update', 'end'].includes(phase)) return;
    if (phase === 'start') {
      gesture = { kind, cursor: screen.getCursorScreenPoint(), bounds: panel.getBounds() };
      return;
    }
    if (!gesture || gesture.kind !== kind) return;
    const p = screen.getCursorScreenPoint();
    const dx = p.x - gesture.cursor.x, dy = p.y - gesture.cursor.y;
    const b = gesture.bounds;
    if (kind === 'move') panel.setPosition(b.x + dx, b.y + dy);
    else panel.setSize(Math.max(PANEL_MIN.width, b.width + dx), Math.max(PANEL_MIN.height, b.height + dy));
    if (phase === 'end') gesture = null;
  });
  ipcMain.on('panel:close', (e) => { if (fromPanel(e)) panel.close(); });

  // Saved bounds, if they still fall on a screen (a monitor may have been unplugged since)
  function savedPanelBounds() {
    const b = cfg.panelBounds;
    if (!b) return null;
    const a = screen.getDisplayMatching(b).workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y ? b : null;
  }

  function openPanel() {
    if (panel) {
      if (panel.isMinimized()) panel.restore();
      panel.showInactive();
      return;
    }
    panelToken = devices.add(t('devices.thisPc'), '127.0.0.1', { local: true }).token;
    // focusable: false keeps the focus on the app in front when the panel is tapped. On Linux, Electron
    // does that with an override-redirect window: the window manager never focuses it (checked on GNOME,
    // where every managed window type took the focus on a click), but it also gets no frame, can't be
    // moved, resized or closed by the desktop and always stays on top. The viewer's own bar replaces
    // the frame there (panel-preload.js and the panel:gesture / panel:close messages).
    panel = new BrowserWindow({
      ...(savedPanelBounds() || { width: 900, height: 640 }),
      minWidth: PANEL_MIN.width, minHeight: PANEL_MIN.height,
      focusable: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      title: t('panel.title'), autoHideMenuBar: true,
      backgroundColor: '#0d1b2a', icon: path.join(__dirname, 'viewer', 'brand', 'icon-512.png'),
      webPreferences: {
        preload: path.join(__dirname, 'desktop', 'panel-preload.js'),
        partition: 'persist:panel',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // Set here, not as a window option: the option is ignored on a window that never activates
    const keepOnTop = () => { if (cfg.panelAlwaysOnTop) panel.setAlwaysOnTop(true, PANEL_TOP_LEVEL); };
    keepOnTop();
    const wc = panel.webContents;
    panel.on('page-title-updated', (e) => e.preventDefault()); // keep "LibreShard · This PC"
    wc.on('will-navigate', (e, url) => { if (new URL(url).origin !== panelOrigin()) e.preventDefault(); });
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Linux: the window manager can't make the frameless panel full screen either, so the panel covers
    // the display here and gets its bounds back when the viewer leaves full screen. By the time the
    // event arrives Electron already reports the display's bounds, so the windowed ones are tracked
    // beforehand. It also believes the window sits at the display's corner while X still has it where
    // it was, so a first nudge makes it really move.
    let windowedBounds = null; // set while the panel covers the display
    let lastWindowed = panel.getBounds();
    if (process.platform === 'linux') {
      const track = () => { if (!windowedBounds && !panel.isFullScreen()) lastWindowed = panel.getBounds(); };
      panel.on('move', track);
      panel.on('resize', track);
      panel.on('enter-html-full-screen', () => {
        windowedBounds = lastWindowed;
        const b = screen.getDisplayMatching(windowedBounds).bounds;
        setTimeout(() => {
          if (!panel || panel.isDestroyed()) return;
          panel.setBounds({ ...b, x: b.x + 1 });
          panel.setBounds(b);
        }, 0);
      });
      panel.on('leave-html-full-screen', () => {
        const b = windowedBounds;
        if (b) setTimeout(() => { if (panel && !panel.isDestroyed()) panel.setBounds(b); windowedBounds = null; }, 0);
      });
    }

    let saveTimer = null;
    const saveBounds = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!panel || panel.isDestroyed() || windowedBounds || panel.isFullScreen() || panel.isMaximized() || panel.isMinimized()) return;
        cfg.panelBounds = panel.getBounds();
        saveConfig(cfg);
      }, 500);
    };
    panel.on('move', saveBounds);
    panel.on('resize', saveBounds);

    // Windows can't move or resize with the mouse a window that never activates (a finger on the title
    // bar can). While the mouse moves over the frame, the panel may take the focus so it drags like any
    // window. It lets go when the drag or resize ends and when the pointer is back on the shard, and
    // Windows returns the focus to the app that had it.
    let frameTimer = null;
    if (process.platform === 'win32') {
      const inside = (p, r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
      // setFocusable() drops always-on-top, so it's applied again after each switch
      const letGo = () => { if (panel.isFocusable()) { panel.setFocusable(false); keepOnTop(); } };
      const same = (a, b) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      let last = null, lastBounds = null, hovering = 0;
      frameTimer = setInterval(() => {
        if (!panel.isVisible()) return;
        const p = screen.getCursorScreenPoint();
        const b = panel.getBounds();
        const moving = !!last && (p.x !== last.x || p.y !== last.y);
        const still = same(lastBounds, b);
        last = p;
        lastBounds = b;
        if (panel.isFocusable()) {
          if (inside(p, panel.getContentBounds())) letGo();
          return;
        }
        // Only a mouse: it moves over the frame for a while with the window still. A finger jumps there
        // once, then rests or drags the window (which needs no focus), and a touch on the shard doesn't
        // move the pointer at all, so a finger must never make the panel focusable.
        hovering = moving && still && inside(p, b) && !inside(p, panel.getContentBounds()) ? hovering + 1 : 0;
        if (hovering >= 2) {
          hovering = 0;
          panel.setFocusable(true);
          keepOnTop();
          panel.setSkipTaskbar(true); // focusable windows get a taskbar button; the panel never has one
        }
      }, 50);
      wc.on('input-event', (_e, input) => { if (input.type === 'mouseMove') letGo(); });
      panel.on('moved', letGo);
      panel.on('resized', letGo);
    }

    panel.on('closed', () => {
      clearInterval(frameTimer);
      clearTimeout(saveTimer);
      panel = null;
      panelToken = null;
    });
    panel.loadURL(panelOrigin() + '/?embedded=1');
  }

  /* ---------- Tray ---------- */

  // The tray keeps LibreShard (and the server) running with the window closed. Some Linux desktops
  // have no tray; then closing the window quits as before.
  let tray = null;
  function updateTray() {
    if (!tray) return;
    tray.setToolTip(server.isPaused() ? `LibreShard · ${t('status.paused')}` : 'LibreShard');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('tray.open'), click: showWindow },
      { label: t('tray.panel'), click: openPanel },
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
  // The page never navigates or opens windows
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
  // Closing the window for real (no tray, or quitting) takes the panel with it
  win.on('closed', () => { if (panel) panel.destroy(); });
  win.loadFile(DESKTOP_PAGE);
}

app.on('window-all-closed', () => app.quit());
