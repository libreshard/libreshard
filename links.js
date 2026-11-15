// libreshard:// links, opened from a web page (a shard author's site, later the gallery).
// The only command is install:
//   libreshard://install?url=<https://…>   download that file, then the usual review
// The link only says what to fetch; the app always asks before downloading and shows the review
// before installing. Anything else is ignored.
const MAX_LINK = 4096;

// The first libreshard:// argument in a command line (Windows and Linux pass the link that way)
const linkInArgs = (argv) => (Array.isArray(argv) ? argv.find((a) => typeof a === 'string' && /^libreshard:/i.test(a)) : undefined);

// A link → { action: 'install', url } or null. The url is only taken out here; download.js checks it.
function parseLink(value) {
  if (typeof value !== 'string' || value.length > MAX_LINK) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol !== 'libreshard:') return null;
  // "libreshard://install?…" puts the command in the host; "libreshard:install?…" in the path
  const action = (u.hostname || u.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
  if (action !== 'install') return null;
  const url = u.searchParams.get('url');
  return url ? { action: 'install', url } : null;
}

module.exports = { parseLink, linkInArgs };
