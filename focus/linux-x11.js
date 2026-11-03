// Provider for Linux under X11 that needs nothing installed through npm: it asks the X server with
// xprop (package x11-utils) for the active window, its process and its class, much like active-win.
// Used when active-win is missing: on Linux its install script needs a C++ toolchain even though its
// Linux code doesn't, so on a typical desktop npm silently drops it.
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const xprop = (args) => new Promise((resolve, reject) => {
  execFile('xprop', args, { timeout: 1500 }, (e, out) => (e ? reject(e) : resolve(out)));
});

let hasXprop = null;
function available() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  if (hasXprop === null) {
    try { execFileSync('xprop', ['-version'], { stdio: 'ignore', timeout: 1500 }); hasXprop = true; } catch { hasXprop = false; }
  }
  return hasXprop;
}

// "WM_CLASS(STRING) = "mousepad", "Mousepad"" → ['mousepad', 'Mousepad']
const quoted = (line) => [...String(line || '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

// xprop's answer for one window → { pid, name, title }. Missing properties give 0 / ''.
function parseWindow(out) {
  const line = (name) => String(out).split('\n').find((l) => l.startsWith(name + '('));
  const pid = Number((line('_NET_WM_PID') || '').split('=').pop());
  const cls = quoted(line('WM_CLASS'));
  const title = quoted(line('_NET_WM_NAME'))[0] ?? quoted(line('WM_NAME'))[0] ?? '';
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : 0, name: cls[1] || cls[0] || '', title };
}

async function windowInfo(id) {
  const out = await xprop(['-id', id, '_NET_WM_PID', 'WM_CLASS', '_NET_WM_NAME', 'WM_NAME']);
  const { pid, name, title } = parseWindow(out);
  let exePath = '';
  if (pid) {
    try { exePath = fs.readlinkSync(`/proc/${pid}/exe`); } catch { /* another user's process, or gone */ }
  }
  return { exe: exePath ? path.basename(exePath) : '', name, title, path: exePath };
}

async function active() {
  const out = await xprop(['-root', '_NET_ACTIVE_WINDOW']);
  const id = (out.match(/window id # (0x[0-9a-f]+)/i) || [])[1];
  if (!id || /^0x0+$/i.test(id)) return null;
  return windowInfo(id);
}

async function openWindows() {
  const out = await xprop(['-root', '_NET_CLIENT_LIST']);
  const ids = out.match(/0x[0-9a-f]+/gi) || [];
  const all = await Promise.all(ids.map((id) => windowInfo(id).catch(() => null)));
  return all.filter((w) => w && w.exe);
}

module.exports = { name: 'linux-x11', available, active, openWindows, parseWindow };
