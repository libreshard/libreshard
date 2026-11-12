// "Is there a newer LibreShard?" The app's only connection outside the user's network: once a day
// (and on "Check now") it asks GitHub for the latest release. It sends nothing but a generic
// User-Agent, installs nothing, and the user can turn it off (setting checkUpdates).
//
// GitHub's /releases/latest is the release marked "Latest": never a draft or a pre-release. A
// version stays a pre-release while people try it, so only tested versions are announced.

const LATEST_URL = 'https://api.github.com/repos/libreshard/libreshard/releases/latest';
const TIMEOUT_MS = 15000;

// "v0.3.0" / "0.3.0-beta.1" → { nums: [0, 3, 0], pre: 'beta.1' }, or null if it isn't a version
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' } : null;
}

// Semantic Versioning order: >0 when a is newer than b, <0 when older, 0 when equal (or unparseable).
// A pre-release comes before its release (0.3.0-beta < 0.3.0); pre-release tags compare part by part.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xs = x.pre.split('.');
  const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    if (xn && yn && Number(xs[i]) !== Number(ys[i])) return Number(xs[i]) - Number(ys[i]);
    if (xn !== yn) return xn ? -1 : 1;
    if (!xn && xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}

// Asks GitHub for the latest release. fetch is injectable (Electron's net.fetch in the app).
// Resolves with { latest: '0.4.0', newer: true|false }; rejects on network errors or odd answers.
async function checkLatest({ current, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LibreShard' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = await res.json();
  const latest = String(body?.tag_name || '').replace(/^v/, '');
  if (!parseVersion(latest)) throw new Error('No version in the answer');
  return { latest, newer: compareVersions(latest, current) > 0 };
}

module.exports = { parseVersion, compareVersions, checkLatest, LATEST_URL };
