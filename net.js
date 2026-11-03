// Network checks: which Host headers the server answers to, and which client addresses it accepts.
const os = require('os');

// Hostnames always accepted, besides the PC's own addresses
const FIXED_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'libreshard.local'];

// The PC's current IP addresses. Cached briefly: interfaces change (Wi-Fi, VPN) but not per request.
let cache = { t: 0, v: new Set() };
function localAddresses() {
  if (Date.now() - cache.t < 5000) return cache.v;
  const v = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) v.add(a.family === 'IPv6' ? `[${a.address.split('%')[0]}]` : a.address);
  }
  cache = { t: Date.now(), v };
  return v;
}

// "192.168.0.10:7878" → "192.168.0.10", "[fe80::1]:7878" → "[fe80::1]"
function hostname(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

// A Host header pointing anywhere else is what a DNS rebinding attack looks like
function hostAllowed(hostHeader) {
  const h = hostname(hostHeader);
  return !!h && (FIXED_HOSTS.includes(h) || localAddresses().has(h));
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

const PRIVATE_V4 = [
  ['127.0.0.0', 8], // loopback
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16], // link-local
  ['100.64.0.0', 10], // carrier-grade NAT, used by Tailscale
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

// Loopback, private ranges, link-local and Tailscale. Public addresses are refused by default.
function isPrivateAddress(addr) {
  if (typeof addr !== 'string') return false;
  let a = addr.toLowerCase().split('%')[0];
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  const n = ipv4ToInt(a);
  if (n !== null) return PRIVATE_V4.some(([base, mask]) => ((n & mask) >>> 0) === base);
  if (a === '::1') return true;
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a); // fc00::/7 and fe80::/10
}

module.exports = { hostAllowed, hostname, isPrivateAddress, localAddresses };
