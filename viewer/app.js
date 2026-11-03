const $ = (id) => document.getElementById(id);
const BACK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const FS_ON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ZOOM_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
const FS_OFF_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

let ws, authed = false, shards = [], current = null;
let wasAuthed = false; // after the first sign-in, a reconnection refetches the list (it may have changed meanwhile)

// UI strings come from the PC (i18n/*.json), in the tablet's language unless the PC chose one
let strings = {};
let shardQuery = ''; // ?lang=…&os=… for every shard: its language and the PC's system (see shard-api.js)
function t(key, vars = {}) {
  return (strings[key] || key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
const stringsReady = fetch('/api/strings?lang=' + encodeURIComponent(navigator.language || ''))
  .then((r) => r.json())
  .then((r) => {
    strings = r.strings || {};
    document.documentElement.lang = r.locale || 'en';
    shardQuery = new URLSearchParams({ lang: r.shardLang || r.locale || 'en', os: r.platform || '' }).toString();
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  })
  .catch(() => {});
const held = new Set(); // held keys, as "shardId|ctrl"

const label = (s) => String(s.name || s.id);
const send = (obj) => (ws && ws.readyState === 1 ? (ws.send(JSON.stringify(obj)), true) : false);

/* ---------- Connection ---------- */
// Each paired tablet keeps its own device token. The QR brings a one-time pairing token in
// ?pair=…; without it, the user types the 6-digit code shown on the PC.
const TOKEN_KEY = 'device-token';
let pendingPair = null; // QR token kept in case the saved device token turns out to be revoked
let retryTimer;

// A readable name for the PC's device list, such as "iPad · Safari"
function deviceName() {
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = ipad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : t('viewer.device');
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : t('viewer.browser');
  return os + ' · ' + browser;
}

function showLock(message) {
  $('msg').textContent = message || '';
  $('code').value = '';
  $('lock').classList.add('on');
  $('offline').hidden = true;
}

// mode: { token } for a paired device, { pairToken } from the QR, or { code } typed by hand
function connect(mode) {
  clearTimeout(retryTimer);
  let lastError = null;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => {
    if (mode.token) send({ type: 'auth', token: mode.token });
    else send({ type: 'pair', token: mode.pairToken, code: mode.code, name: deviceName() });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'paired') localStorage.setItem(TOKEN_KEY, m.token);
    if (m.type === 'ok' || m.type === 'paired') {
      authed = true;
      pendingPair = null;
      $('msg').textContent = '';
      $('lock').classList.remove('on');
      $('offline').hidden = true;
      setPaused(m.paused);
      if (current) send({ type: 'open', shard: current });
      if (wasAuthed) resync(); else listReady.then(route);
      wasAuthed = true;
    }
    if (m.type === 'pending') $('msg').textContent = t('viewer.pending');
    if (m.type === 'paused') setPaused(m.value);
    if (m.type === 'shards-changed') refreshShards();
    if (m.type === 'settings') onSettings(m.shard, m.values);
    if (m.type === 'shard-files-changed' && m.shard === current) reloadShard();
    if (m.type === 'focus' && m.shard === current) showFocus(m);
    if (m.type === 'error') lastError = m;
    if (m.type === 'denied') console.warn('Key not allowed by the shard:', m.keys);
    if (m.type === 'blocked' && m.reason === 'self') {
      showToast(t('viewer.blockedSelf'));
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    } else if (m.type === 'blocked') {
      const where = (m.apps || []).join(', ');
      const now = m.active ? t('viewer.activeNow', { app: m.active }) : t('viewer.activeUnknown');
      // The PC offers to add the program it detected; the tablet only says "yes" for this shard
      const action = m.canAllow
        ? { label: t('viewer.allowHere', { app: m.app }), run: () => send({ type: 'allow-app', shard: m.shard }) }
        : null;
      showToast(t('viewer.blocked', { apps: where }) + ' ' + now, action);
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    }
    if (m.type === 'allowed') showToast(t('viewer.allowed', { app: m.app }));
    if (m.type === 'error' && m.code === 'allow-failed') showToast(t('viewer.allowFailed'));
    if (m.type === 'error' && m.code === 'key-unavailable') showToast(t('viewer.keyUnavailable', { keys: m.keys.toUpperCase() }));
  };
  ws.onclose = (e) => {
    authed = false;
    held.clear();
    $('focusbar').hidden = true;
    if (e.code === 4001) {
      if (mode.token) {
        // The PC no longer knows this device (revoked, or its data was reset)
        localStorage.removeItem(TOKEN_KEY);
        if (pendingPair) return connect({ pairToken: pendingPair });
        return showLock(t('viewer.revoked'));
      }
      pendingPair = null;
      return showLock(mode.pairToken
        ? t('viewer.qrUsed')
        : t('viewer.codeWrong'));
    }
    if (e.code === 4003) {
      pendingPair = null;
      return showLock(t('viewer.rejected'));
    }
    if (e.code === 4029) {
      pendingPair = null;
      return showLock(t('viewer.tooMany', { seconds: (lastError && lastError.retryAfter) || 30 }));
    }
    // Connection lost: a paired device keeps retrying; a pairing attempt goes back to the lock screen
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      $('offline').hidden = false;
      retryTimer = setTimeout(() => connect({ token }), 1500);
    } else {
      showLock(t('viewer.noConnection'));
    }
  };
}

$('pairForm').onsubmit = (e) => {
  e.preventDefault();
  const code = $('code').value.replace(/\D/g, '');
  if (code.length !== 6) {
    $('msg').textContent = t('viewer.codeLength');
    return;
  }
  connect({ code });
};

/* ---------- Notices ---------- */
let toastTimer;
// action (optional): { label, run } adds a button; the notice then stays longer
function showToast(text, action) {
  const el = $('toast');
  el.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { hideToast(); action.run(); };
    el.append(b);
  }
  el.hidden = false;
  document.body.classList.add('toasting'); // the live indicator sits at the same spot
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 9000 : 4500);
}

function hideToast() {
  $('toast').hidden = true;
  document.body.classList.remove('toasting');
}

/* ---------- Full screen ---------- */
// iPhone has no Fullscreen API: the option is hidden there
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

// Both must run inside the user's tap: browsers refuse full screen (and the wake video) otherwise
function toggleFullscreen() {
  if (!isFullscreen()) return enterFullscreen(true);
  keepAwake(false);
  const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  if (p && p.catch) p.catch(() => keepAwake(isFullscreen()));
}

// report: say so if the browser refuses (the automatic entry from the menu stays quiet)
function enterFullscreen(report) {
  if (!fsSupported || isFullscreen()) return;
  const root = document.documentElement;
  keepAwake(true);
  const p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  if (p && p.catch) p.catch(() => {
    keepAwake(isFullscreen());
    if (report) showToast(t('viewer.fullscreenFailed'));
  });
}

/* ---------- This device's settings ---------- */
// Open shards full screen when picked from the menu: on by default, only the opt-out is stored
const AUTO_FS_KEY = 'auto-fullscreen';
const autoFullscreen = () => localStorage.getItem(AUTO_FS_KEY) !== 'off';

function setDeviceSheet(open) {
  $('devSheet').hidden = $('devScrim').hidden = !open;
  $('devBtn').setAttribute('aria-expanded', String(open));
  if (open) $('autoFs').checked = autoFullscreen();
}
$('devBtn').onclick = () => setDeviceSheet($('devSheet').hidden);
$('devScrim').onclick = () => setDeviceSheet(false);
$('autoFs').onchange = (e) => {
  if (e.target.checked) localStorage.removeItem(AUTO_FS_KEY); else localStorage.setItem(AUTO_FS_KEY, 'off');
};
// Full screen is the only setting so far: without the API there is nothing to show
$('devBtn').hidden = !fsSupported;

// Fills a button with the icon and text for the current state
function fillFsButton(b) {
  const on = isFullscreen();
  b.innerHTML = on ? FS_OFF_SVG : FS_ON_SVG;
  b.append(on ? t('viewer.fullscreenExit') : t('viewer.fullscreen'));
}

function updateFs() {
  if (!isFullscreen()) keepAwake(false);
  $('fsMenu').hidden = !fsSupported;
  if (fsSupported) fillFsButton($('fsMenu'));
  if (current) renderPanel();
}

/* ---------- Keep the screen on (while in full screen) ---------- */
// navigator.wakeLock only exists in secure contexts (HTTPS or localhost). The tablet uses
// http://IP, so there the classic trick is used: a silent 2 s video on a loop.
// It must start inside the user's tap, which is why keepAwake(true) is called from toggleFullscreen.
let wakeLock = null, wakeVideo = null;
async function keepAwake(on) {
  if (!on) {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (wakeVideo) wakeVideo.pause();
    return;
  }
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return;
    } catch {}
  }
  if (!wakeVideo) {
    wakeVideo = document.createElement('video');
    wakeVideo.src = '/nosleep.webm';
    wakeVideo.loop = true;
    wakeVideo.playsInline = true;
    wakeVideo.setAttribute('playsinline', '');
  }
  wakeVideo.play().catch(() => {});
}
// The system drops the wake lock when the page is hidden: take it back on return if still in full screen
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isFullscreen() && !wakeLock) keepAwake(true);
});

$('fsMenu').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', updateFs);
document.addEventListener('webkitfullscreenchange', updateFs);
stringsReady.then(updateFs);

/* ---------- Shard list and main menu ---------- */
function favoriteMark(s) {
  if (!s.favorite) return null;
  const star = document.createElement('span');
  star.className = 'fav';
  star.textContent = '★';
  star.title = t('viewer.favorite');
  star.setAttribute('aria-label', t('viewer.favorite'));
  return star;
}

function iconEl(s) {
  const d = document.createElement('span');
  d.className = 'ico';
  d.textContent = s.icon ? [...String(s.icon)].slice(0, 2).join('') : label(s).trim().charAt(0).toUpperCase();
  return d;
}

function renderMenu() {
  const list = $('list');
  list.replaceChildren();
  $('empty').hidden = shards.length > 0;
  if (!shards.length) {
    $('empty').textContent = t('viewer.noShards');
  }
  for (const s of shards) {
    const b = document.createElement('button');
    b.className = 'card';
    b.append(iconEl(s));
    const fav = favoriteMark(s);
    if (fav) b.append(fav);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = label(s);
    b.append(name);
    if (s.author) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = t('viewer.by', { author: String(s.author) });
      b.append(meta);
    }
    if (Array.isArray(s.apps) && s.apps.length) {
      const only = document.createElement('div');
      only.className = 'meta';
      only.textContent = t('viewer.onlyIn', { apps: s.apps.map(String).join(', ') });
      b.append(only);
    }
    if (s.pending) {
      const pending = document.createElement('div');
      pending.className = 'meta warn';
      pending.textContent = t('viewer.pendingPerms');
      b.append(pending);
    }
    if (s.description) {
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = String(s.description).slice(0, 120);
      b.append(desc);
    }
    b.onclick = () => {
      if (autoFullscreen()) enterFullscreen(false);
      location.hash = s.id;
    };
    list.append(b);
  }
}

const loadShards = () => fetch('/api/shards')
  .then((r) => r.json())
  .then((list) => { shards = list; renderMenu(); })
  .catch(() => {
    $('empty').hidden = false;
    $('empty').textContent = t('viewer.listFailed');
  });
const listReady = stringsReady.then(loadShards);

// The PC installed, removed, approved or disabled a shard: refresh the menu, and leave the open
// shard if it's gone
function refreshShards() {
  loadShards().then(() => {
    if (current && !shards.some((s) => s.id === current)) location.hash = '';
    else if (current) renderPanel();
  });
}

// Back online: shards and settings may have changed while the tablet was away (PC restarted, tab
// frozen in the background…). Refetch the list and give the open shard its current settings.
function resync() {
  loadShards().then(() => {
    const s = current && shards.find((x) => x.id === current);
    if (current && !s) location.hash = '';
    else if (s) { renderPanel(); onSettings(s.id, s.settings || {}); }
    route();
  });
}

// While the PC is paused nothing is pressed; a strip says so
function setPaused(on) {
  $('paused').hidden = !on;
  if (on) {
    releaseHeld();
    $('focusbar').hidden = true;
  } else if (current && authed) {
    send({ type: 'open', shard: current }); // the server answers with the current live state
  }
}

/* ---------- Navigation (the hash is the open shard's id) ---------- */
function releaseHeld() {
  for (const k of held) {
    const i = k.indexOf('|');
    send({ type: 'up', shard: k.slice(0, i), keys: k.slice(i + 1) });
  }
  held.clear();
}

function route() {
  if (!authed) return;
  const id = decodeURIComponent(location.hash.slice(1));
  const s = shards.find((x) => x.id === id);
  if (s) showShard(s); else showMenu();
}

// Live indicator: whether the open shard can act with the app that's in front on the PC
function showFocus(m) {
  const bar = $('focusbar');
  // While the PC is paused its own strip says enough
  bar.hidden = m.ok || !$('paused').hidden;
  if (!m.ok) {
    bar.textContent = m.active
      ? t('viewer.focusPaused', { apps: (m.apps || []).join(', '), app: m.active })
      : t('viewer.focusUnknown');
  }
}

// Settings changed on the PC: keep them, and pass them to the open shard
function onSettings(id, values) {
  const s = shards.find((x) => x.id === id);
  if (s) s.settings = values;
  if (id === current) $('frame').contentWindow.postMessage({ __libreshard: true, t: 'settings', values }, '*');
}

const shardUrl = (id) => '/shards/' + id + '/index.html?' + shardQuery;

// Development mode: a linked shard's files changed on the PC
function reloadShard() {
  $('frame').src = shardUrl(current) + '&v=' + Date.now();
}

function showMenu() {
  releaseHeld();
  current = null;
  closePanel();
  $('frame').src = 'about:blank'; // unloads the shard
  $('focusbar').hidden = true;
  send({ type: 'open', shard: null });
  $('stage').hidden = true;
  $('menu').hidden = false;
}

function showShard(s) {
  if (current === s.id && !$('stage').hidden) return;
  releaseHeld();
  current = s.id;
  closePanel();
  setDeviceSheet(false);
  $('menu').hidden = true;
  $('stage').hidden = false;
  $('frame').title = label(s);
  applyZoom();
  $('frame').src = shardUrl(s.id);
  $('focusbar').hidden = true;
  send({ type: 'open', shard: s.id });
  renderPanel();
}

window.addEventListener('hashchange', route);

/* ---------- Shard zoom (saved per shard) ---------- */
const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.1;
const getZoom = () => Number(localStorage.getItem('zoom:' + current)) || 1;
function applyZoom() { $('frame').style.setProperty('--zoom', getZoom()); }
function setZoom(z) {
  z = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
  if (z === 1) localStorage.removeItem('zoom:' + current); else localStorage.setItem('zoom:' + current, z);
  applyZoom();
  renderPanel();
}

/* ---------- Floating button and panel ---------- */
function renderPanel() {
  const p = $('panel');
  p.replaceChildren();

  const back = document.createElement('button');
  back.className = 'item';
  back.innerHTML = BACK_SVG;
  back.append(t('viewer.mainMenu'));
  back.onclick = () => { location.hash = ''; };
  p.append(back);

  if (fsSupported) {
    const fs = document.createElement('button');
    fs.className = 'item';
    fillFsButton(fs);
    fs.onclick = () => { closePanel(); toggleFullscreen(); };
    p.append(fs);
  }

  // Zoom doesn't close the panel, so it can be adjusted several times in a row
  const z = getZoom();
  const zoom = document.createElement('div');
  zoom.className = 'zoom';
  const zl = document.createElement('span');
  zl.className = 'zl';
  zl.innerHTML = ZOOM_SVG;
  zl.append(t('viewer.zoom'));
  const minus = document.createElement('button');
  minus.textContent = '−';
  minus.setAttribute('aria-label', t('viewer.zoomOut'));
  minus.disabled = z <= ZOOM_MIN;
  minus.onclick = () => setZoom(z - ZOOM_STEP);
  const out = document.createElement('output');
  out.textContent = Math.round(z * 100) + '%';
  out.onclick = () => setZoom(1); // tapping the percentage resets it to 100%
  const plus = document.createElement('button');
  plus.textContent = '+';
  plus.setAttribute('aria-label', t('viewer.zoomIn'));
  plus.disabled = z >= ZOOM_MAX;
  plus.onclick = () => setZoom(z + ZOOM_STEP);
  zoom.append(zl, minus, out, plus);
  p.append(zoom);

  const others = shards.filter((s) => s.id !== current);
  if (others.length) {
    const sep = document.createElement('div');
    sep.className = 'sep';
    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.textContent = t('viewer.switchTo');
    p.append(sep, hd);
    for (const s of others) {
      const b = document.createElement('button');
      b.className = 'item';
      b.append(iconEl(s));
      b.append(label(s));
      b.onclick = () => { location.hash = s.id; };
      p.append(b);
    }
  }
}

function setPanel(open) {
  $('panel').hidden = !open;
  $('scrim').hidden = !open;
  $('fab').setAttribute('aria-expanded', String(open));
}
function closePanel() { setPanel(false); }

$('fab').onclick = () => setPanel($('panel').hidden);
$('scrim').onclick = closePanel;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePanel(); setDeviceSheet(false); }
});

/* ---------- Shard → PC bridge ---------- */
const DATA_MAX = 64 * 1024; // limit on the data each shard can save

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.__shard || !current || e.source !== $('frame').contentWindow) return;

  // Shard storage: the iframe has no localStorage of its own (opaque origin), so the viewer
  // stores a string for it under its id. The id comes from `current`, never from the message.
  if (d.t === 'save' && typeof d.data === 'string' && d.data.length <= DATA_MAX) {
    try { localStorage.setItem('shard-data:' + current, d.data); } catch {}
    return;
  }
  if (d.t === 'load') {
    e.source.postMessage({ __libreshard: true, t: 'data', id: d.id, data: localStorage.getItem('shard-data:' + current) }, '*');
    return;
  }
  if (d.t === 'settings') {
    const s = shards.find((x) => x.id === current);
    e.source.postMessage({ __libreshard: true, t: 'settings', id: d.id, values: (s && s.settings) || {} }, '*');
    return;
  }

  if (!['press', 'down', 'up'].includes(d.t) || typeof d.keys !== 'string') return;
  if (d.t === 'down') held.add(current + '|' + d.keys);
  if (d.t === 'up') held.delete(current + '|' + d.keys);
  if (navigator.vibrate && d.t !== 'up') navigator.vibrate(15);
  send({ type: d.t, shard: current, keys: d.keys });
});

// If the screen turns off or the user switches apps, release anything held
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); });
window.addEventListener('pagehide', releaseHeld);

/* ---------- Startup ---------- */
// The QR carries a one-time pairing token: take it and remove it from the address bar
const params = new URLSearchParams(location.search);
const qrToken = params.get('pair');
if (params.has('pair')) history.replaceState(null, '', location.pathname + location.hash);
const savedToken = localStorage.getItem(TOKEN_KEY);
stringsReady.then(() => {
  if (savedToken) {
    pendingPair = qrToken;
    connect({ token: savedToken });
  } else if (qrToken) {
    connect({ pairToken: qrToken });
  } else {
    showLock('');
  }
});
