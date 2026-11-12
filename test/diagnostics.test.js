const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnostics, systemLabel } = require('../diagnostics');

const home = process.platform === 'win32' ? 'C:\\Users\\Someone' : '/home/someone';
const info = (extra = {}) => ({
  version: '0.3.0', packaged: true, platform: 'win32', release: '10.0.26300', arch: 'x64',
  versions: { electron: '45.2.1', chrome: '142.0', node: '22.0' },
  focus: 'active-win',
  settings: { port: 7878, confirmDevices: false, language: 'auto' },
  devices: { total: 2, local: true },
  networks: { total: 3, vpn: 1 },
  shards: [
    { id: 'discord', version: '1.0.0', bundled: true, linked: false, enabled: true, pendingKeys: 0, apps: 0 },
    { id: 'mine', version: '0.1.0', bundled: false, linked: false, enabled: false, pendingKeys: 2, apps: 1 },
    { id: 'dev', bundled: false, linked: true, enabled: true, pendingKeys: 0, apps: 0 },
  ],
  rejected: ['broken'],
  log: ['2026-11-11T18:00:00.000Z INFO  start version=0.3.0', `2026-11-11T18:00:01.000Z ERROR boom error="${home}"`],
  now: new Date('2026-11-11T18:05:00.000Z'),
  ...extra,
});

test('the diagnostics list the app, system, settings, shards and the log', () => {
  const text = buildDiagnostics(info(), { home });
  for (const part of [
    'LibreShard diagnostics',
    'Generated: 2026-11-11T18:05:00.000Z',
    'App: 0.3.0\n',
    'System: Windows 10.0.26300 x64',
    'Electron 45.2.1 · Chromium 142.0 · Node 22.0',
    'Foreground app detection: active-win',
    'Settings: port=7878 confirmDevices=false language=auto',
    'Paired devices: 2 (one is the This PC panel)',
    'Networks: 3 (1 VPN)',
    'Shards (3):',
    '  discord 1.0.0 (bundled, enabled)',
    '  mine 0.1.0 (installed, disabled, 2 keys waiting for approval, limited to certain apps (1))',
    '  dev ? (development, enabled)',
    'Rejected shard folders (1):\n  broken',
    'Log (last 2 lines):\n2026-11-11T18:00:00.000Z INFO  start version=0.3.0',
  ]) assert.ok(text.includes(part), `missing: ${part}\n---\n${text}`);
});

test('the home folder never appears, and optional parts are left out when empty', () => {
  const text = buildDiagnostics(info({ rejected: [], packaged: false, devices: { total: 1, local: false }, networks: { total: 1, vpn: 0 } }), { home });
  assert.ok(!text.includes(home));
  assert.ok(text.includes('error="~"'));
  assert.ok(text.includes('App: 0.3.0 (development)'));
  assert.ok(text.includes('Paired devices: 1\n'));
  assert.ok(text.includes('Networks: 1\n'));
  assert.ok(!text.includes('Rejected'));
});

test('the system label names the system, and the session on Linux', () => {
  assert.equal(systemLabel({ platform: 'win32', release: '10.0.26300', arch: 'x64' }), 'Windows 10.0.26300 x64');
  assert.equal(systemLabel({ platform: 'linux', release: '6.8.0', arch: 'x64', session: 'x11' }), 'Linux 6.8.0 x64 (x11)');
  assert.equal(systemLabel({ platform: 'linux', release: '6.8.0', arch: 'x64' }), 'Linux 6.8.0 x64 (unknown session)');
});
