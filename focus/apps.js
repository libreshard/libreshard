// App entries used in shard rules, and how they match the foreground app.
//   { exe: 'Photoshop.exe', name: 'Adobe Photoshop 2025', path? }  exact executable (preferred)
//   { match: 'photoshop' }                                          case-insensitive "contains"
// Plain strings (manifests, old app-rules.json) are read as { match }.

const MAX = 100;
const clip = (s, n = MAX) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

// "C:\\Apps\\Photoshop.exe" → "photoshop" (lowercase, no folder, no .exe), so rules work on every OS
const exeKey = (exe) => clip(exe, 260).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');

// Returns a clean entry, or null if it can't be used
function normalizeApp(entry) {
  if (typeof entry === 'string') return clip(entry) ? { match: clip(entry) } : null;
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.exe === 'string' && exeKey(entry.exe)) {
    const out = { exe: clip(entry.exe.split(/[\\/]/).pop()), name: clip(entry.name) || clip(entry.exe.split(/[\\/]/).pop()) };
    if (typeof entry.path === 'string' && entry.path.trim()) out.path = clip(entry.path, 260);
    return out;
  }
  if (typeof entry.match === 'string' && clip(entry.match)) return { match: clip(entry.match) };
  return null;
}

// What the tablet and the PC show for an entry
const appLabel = (entry) => entry.name || entry.exe || entry.match || '';

// `active` is { exe, name, title } from a provider. An exe rule compares executables; a text rule
// looks in the program's name and executable, or in the window title when that's all we know.
function appMatches(active, entry) {
  if (!active) return false;
  if (entry.exe) return !!active.exe && exeKey(active.exe) === exeKey(entry.exe);
  const needle = String(entry.match || '').toLowerCase().trim();
  if (!needle) return false;
  const ids = active.exe ? [active.name, active.exe, exeKey(active.exe)] : [active.title];
  return ids.some((id) => typeof id === 'string' && id.toLowerCase().includes(needle));
}

module.exports = { normalizeApp, appLabel, appMatches, exeKey };
