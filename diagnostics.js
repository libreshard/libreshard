// The text "Copy diagnostics" and "Report a bug" put on the clipboard, for the user to paste in a bug
// report. It must help find a problem without exposing the user: it never includes device names,
// IP addresses, network names, tokens or the pairing code. Users still read it before sending it.
const { homeRedactor } = require('./log');

const SYSTEM_NAMES = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

// "Windows 10.0.26300 x64", "Linux 6.8.0 x64 (x11)": for the report form's System field too
function systemLabel({ platform, release, arch, session }) {
  const base = `${SYSTEM_NAMES[platform] || platform} ${release} ${arch}`;
  return platform === 'linux' ? `${base} (${session || 'unknown session'})` : base;
}

// One line per shard: id, version, where it comes from, and what may need attention
function shardLine(s) {
  const origin = s.bundled ? 'bundled' : s.linked ? 'development' : 'installed';
  const notes = [origin, s.enabled ? 'enabled' : 'disabled'];
  if (s.pendingKeys) notes.push(`${s.pendingKeys} keys waiting for approval`);
  if (s.apps) notes.push(`limited to certain apps (${s.apps})`);
  return `  ${s.id} ${s.version || '?'} (${notes.join(', ')})`;
}

// info: {
//   version, packaged, platform, release, arch, session, versions: { electron, chrome, node },
//   focus (detection provider), elevated (LibreShard runs as administrator: true/false/null), settings ({ key: value }, internal ones already left out),
//   devices: { total, local }, networks: { total, vpn },
//   shards: [{ id, version, bundled, linked, enabled, pendingKeys, apps }], rejected: [folder name],
//   log: [line], now: Date
// }
function buildDiagnostics(info, { home } = {}) {
  const redact = homeRedactor(home);
  const v = info.versions || {};
  const lines = [
    'LibreShard diagnostics',
    `Generated: ${(info.now || new Date()).toISOString()}`,
    '',
    `App: ${info.version}${info.packaged ? '' : ' (development)'}`,
    `System: ${systemLabel(info)}`,
    `Electron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}`,
    `Foreground app detection: ${info.focus}`,
    ...(info.platform === 'win32' ? [`Running as administrator: ${info.elevated === true ? 'yes' : info.elevated === false ? 'no' : 'unknown'}`] : []),
    `Settings: ${Object.entries(info.settings).map(([k, val]) => `${k}=${val}`).join(' ')}`,
    `Paired devices: ${info.devices.total}${info.devices.local ? ' (one is the This PC panel)' : ''}`,
    `Networks: ${info.networks.total}${info.networks.vpn ? ` (${info.networks.vpn} VPN)` : ''}`,
    '',
    `Shards (${info.shards.length}):`,
    ...info.shards.map(shardLine),
  ];
  if (info.rejected.length) lines.push('', `Rejected shard folders (${info.rejected.length}):`, ...info.rejected.map((f) => `  ${f}`));
  lines.push('', `Log (last ${info.log.length} lines):`, ...info.log);
  return redact(lines.join('\n')) + '\n';
}

module.exports = { buildDiagnostics, systemLabel };
