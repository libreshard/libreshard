// Linux: quit before the desktop session ends, so Chromium doesn't abort.
//
// When the user logs out, the session's D-Bus bus goes away while LibreShard is still running, and
// Chromium aborts on purpose ("D-Bus connection was disconnected. Aborting.", SIGTRAP), leaving a
// crash report and skipping the release of held keys. Any Electron app with a tray icon hits it now
// and then; LibreShard did every time (checked on Ubuntu 24.04 GNOME and XFCE, 2026-11-12). No
// signal arrives first: the X connection and the bus drop within milliseconds of each other.
//
// The session managers announce the end on D-Bus a little earlier, as signals anyone can watch:
// - GNOME: ClientPrivate.EndSession, once the logout can no longer be cancelled (~340 ms before
//   the bus drops). QueryEndSession comes earlier but can still be cancelled, so it's ignored.
// - XFCE: Manager.StateChanged to 3 (shutdown) or 4 (shutdown phase 2), ~140 ms before. State 3 may
//   in theory still be cancelled by a client, but 4 leaves too little time to quit.
// `gdbus monitor` (GLib, present on these desktops) prints those signals; nothing new is bundled.
// Without gdbus, or on another desktop, nothing is watched and nothing changes.
const { spawn: realSpawn } = require('child_process');
const { nullLog } = require('./log');

const MANAGERS = [
  { desktop: /gnome|unity|budgie|pantheon|cinnamon/i, name: 'org.gnome.SessionManager', ending: (line) => /\.ClientPrivate\.(EndSession|Stop) /.test(line) },
  { desktop: /xfce/i, name: 'org.xfce.SessionManager', ending: (line) => /\.Manager\.StateChanged \(uint32 \d+, uint32 [34]\)/.test(line) },
];

// The session managers to watch for this desktop (XDG_CURRENT_DESKTOP, e.g. "ubuntu:GNOME")
const managersFor = (desktop) => MANAGERS.filter((m) => m.desktop.test(String(desktop || '')));

// Calls onEnd(managerName) once when the session is about to end. Returns stop(). spawn is
// injectable for the tests.
function watchSessionEnd({ onEnd, log = nullLog, desktop = process.env.XDG_CURRENT_DESKTOP, spawn = realSpawn }) {
  const children = [];
  let ended = false;
  for (const m of managersFor(desktop)) {
    let child;
    try {
      child = spawn('gdbus', ['monitor', '--session', '--dest', m.name], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      log.warn('session-watch-failed', { manager: m.name, error: e });
      continue;
    }
    children.push(child);
    child.on('error', (e) => log.warn('session-watch-failed', { manager: m.name, error: e }));
    let rest = '';
    child.stdout.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      if (!ended && lines.some(m.ending)) {
        ended = true;
        onEnd(m.name);
      }
    });
  }
  if (children.length) log.info('session-watch', { managers: managersFor(desktop).map((m) => m.name).join(',') });
  return function stop() {
    for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  };
}

module.exports = { watchSessionEnd, managersFor, MANAGERS };
