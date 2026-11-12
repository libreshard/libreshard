// The app's log on disk (<userData>/logs/libreshard.log), for bug reports: one line per event, with
// the time, the level, an event name and key=value details. Errors add their stack on the lines after.
//
// What goes in: what the app did and what went wrong. What never goes in: keys pressed, window
// titles, device names, IP addresses or the app in front. Callers pass ids and reasons, not user data.
// As a safety net, the user's home folder becomes "~" (paths in errors and stacks carry their name).
//
// The file is rotated by size: libreshard.log → .1 → .2, the oldest is dropped. Lines are appended
// synchronously, so the last ones before a crash are on disk; the app logs a few events, not every tap.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const KEEP = 2; // rotated files kept besides the current one
const MAX_VALUE = 500; // characters per detail value

// A logger that drops everything: the default for modules used without the app (tests, tools)
const nullLog = { info() {}, warn() {}, error() {}, tail: () => [], file: null };

const identity = (s) => s;

// Replaces the home folder (C:\Users\<name>, /home/<name>) with "~"; case-insensitive on Windows
function homeRedactor(home = os.homedir(), platform = process.platform) {
  if (!home || home.length < 3) return identity;
  const re = new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), platform === 'win32' ? 'gi' : 'g');
  return (s) => s.replace(re, '~');
}

// Values with spaces, quotes or '=' are quoted (only quotes and line breaks are escaped, so Windows
// paths stay readable); long ones are cut
function formatValue(v, redact = identity) {
  let s = v instanceof Error ? v.message : typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) s = String(v);
  s = redact(s);
  if (s.length > MAX_VALUE) s = s.slice(0, MAX_VALUE) + '…';
  if (s !== '' && !/[\s"=]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

// "2026-11-11T18:00:00.000Z WARN  event a=1 b="two words"", plus the stack of any Error detail
function formatLine(level, event, details = {}, now = new Date(), redact = identity) {
  const parts = [now.toISOString(), level.toUpperCase().padEnd(5), event];
  const stacks = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v, redact)}`);
    if (v instanceof Error && v.stack) {
      const frames = v.stack.split('\n').slice(1).map((l) => '    ' + redact(l.trim()));
      if (frames.length) stacks.push(frames.join('\n'));
    }
  }
  return [parts.join(' '), ...stacks].join('\n') + '\n';
}

// file: where to write (its folder is created). echo: also print to the console (development).
// home: the folder shown as "~" (the user's, by default).
// A failed write never throws: logging must not break the app. It's reported once on the console.
function createLog({ file, maxBytes = MAX_BYTES, keep = KEEP, echo = false, clock = () => new Date(), home }) {
  const redact = homeRedactor(home);
  let size = 0;
  let broken = false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch { /* reported on the first write */ }

  function rotate() {
    for (let i = keep; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i}`);
    }
    size = 0;
  }

  function write(level, event, details) {
    const line = formatLine(level, event, details, clock(), redact);
    if (echo) (level === 'info' ? console.log : console.error)(line.trimEnd());
    try {
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) rotate();
      fs.appendFileSync(file, line);
      size += bytes;
      broken = false;
    } catch (e) {
      if (!broken) console.error('Could not write the log:', e.message);
      broken = true;
    }
  }

  // The last `n` lines of the current file and, if it's short, of the previous one (for diagnostics)
  function tail(n = 200) {
    const read = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
    let lines = read(file);
    if (lines.length < n && keep >= 1) lines = [...read(`${file}.1`), ...lines];
    return lines.slice(-n);
  }

  return {
    file,
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
    tail,
  };
}

// Device ids are random, but the log only needs enough to tell devices apart
const shortId = (id) => (id ? String(id).slice(0, 6) : undefined);

// Logs each distinct message once: for errors that would repeat on every tap or poll
function once(log, level = 'warn') {
  const seen = new Set();
  return (event, details = {}) => {
    const key = event + ' ' + formatValue(details.error ?? '');
    if (seen.has(key) || seen.size >= 100) return; // past 100 kinds, something is flooding: stop
    seen.add(key);
    log[level](event, details);
  };
}

module.exports = { createLog, nullLog, once, shortId, formatLine, homeRedactor, MAX_BYTES };
