// Detects the foreground app and checks it against a shard's allowed apps.
// Detection goes through providers that all answer the same way, so adding a tool (for example a
// Linux one) is adding a file:
//   name, available(), active() → { exe, name, title, path }, openWindows() (optional) → [same]
// The first available provider is used.
const { appMatches, appLabel } = require('./apps');

function createFocus({ providers = [require('./active-win'), require('./linux-x11'), require('./title')], cacheMs = 100 } = {}) {
  let provider = null;
  let cache = { t: 0, v: null };
  const current = () => (provider = provider || providers.find((p) => p.available()));

  // Short cache so the system isn't queried on every tap
  async function active() {
    const now = Date.now();
    if (cache.v && now - cache.t < cacheMs) return cache.v;
    try { cache = { t: now, v: await current().active() }; } catch { cache = { t: 0, v: null }; }
    return cache.v;
  }

  // The programs with a visible window, one entry per executable, or null if the provider can't list them
  async function openApps() {
    const p = current();
    if (!p.openWindows) return null;
    const byExe = new Map();
    for (const w of await p.openWindows()) {
      if (w.exe && !byExe.has(w.exe.toLowerCase())) byExe.set(w.exe.toLowerCase(), { exe: w.exe, name: w.name || w.exe, path: w.path });
    }
    return [...byExe.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // A readable description of what's in the foreground
  const describe = (a) => (a.exe ? (a.name && a.name !== a.exe ? `${a.name} (${a.exe})` : a.exe) : a.title.slice(0, 80));

  // If the foreground app can't be detected, block: this is a safeguard, so it fails closed.
  // On a mismatch, `app` is the detected program (when known), so the user can allow it.
  async function check(apps) {
    const a = await active();
    if (!a) return { ok: false, reason: 'unknown', active: '' };
    if (apps.some((entry) => appMatches(a, entry))) return { ok: true };
    return { ok: false, reason: 'wrong-app', active: describe(a), app: a.exe ? { exe: a.exe, name: a.name || a.exe, path: a.path } : null };
  }

  return { check, active, openApps, describe, providerName: () => current().name, appLabel };
}

module.exports = { createFocus, ...createFocus() };
