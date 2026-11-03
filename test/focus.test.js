const test = require('node:test');
const assert = require('node:assert/strict');
const { createFocus } = require('../focus');
const { normalizeApp, appMatches, appLabel, exeKey } = require('../focus/apps');

const photoshop = { exe: 'Photoshop.exe', name: 'Adobe Photoshop 2025', title: 'foto.psd @ 100%', path: 'C:\\Apps\\Photoshop.exe' };

test('entries are normalized: strings become text rules, executables keep only the file name', () => {
  assert.deepEqual(normalizeApp('  photoshop '), { match: 'photoshop' });
  assert.deepEqual(normalizeApp({ exe: 'C:\\Apps\\Photoshop.exe', name: 'Photoshop' }), { exe: 'Photoshop.exe', name: 'Photoshop' });
  assert.deepEqual(normalizeApp({ exe: 'krita' }), { exe: 'krita', name: 'krita' });
  assert.deepEqual(normalizeApp({ exe: 'gimp.exe', name: 'GIMP', path: 'C:\\GIMP\\gimp.exe' }), { exe: 'gimp.exe', name: 'GIMP', path: 'C:\\GIMP\\gimp.exe' });
  assert.equal(normalizeApp(''), null);
  assert.equal(normalizeApp({}), null);
  assert.equal(normalizeApp(42), null);
  assert.equal(normalizeApp('x'.repeat(300)).match.length, 100);
});

test('exe rules compare executables exactly, ignoring case, folders and ".exe"', () => {
  assert.equal(exeKey('C:\\Apps\\Photoshop.EXE'), 'photoshop');
  assert.ok(appMatches(photoshop, { exe: 'photoshop.exe' }));
  assert.ok(appMatches(photoshop, { exe: 'Photoshop' }), 'Linux-style name without .exe');
  assert.ok(!appMatches(photoshop, { exe: 'photo.exe' }), 'no partial matches');
  assert.ok(!appMatches({ exe: '', title: 'Photoshop tutorial - Chrome' }, { exe: 'photoshop.exe' }), 'unknown exe never matches');
});

test('text rules look in the program name and exe, or only in the title when that is all we know', () => {
  assert.ok(appMatches(photoshop, { match: 'adobe photoshop' }));
  assert.ok(appMatches(photoshop, { match: 'PHOTOSHOP' }));
  assert.ok(!appMatches(photoshop, { match: 'psd' }), 'the title is ignored when the program is known');
  assert.ok(appMatches({ exe: '', name: '', title: 'foto.psd - Photoshop' }, { match: 'photoshop' }));
  assert.ok(!appMatches(photoshop, { match: '   ' }));
  assert.ok(!appMatches(null, { match: 'x' }));
});

test('labels prefer the friendly name', () => {
  assert.equal(appLabel({ exe: 'Photoshop.exe', name: 'Adobe Photoshop' }), 'Adobe Photoshop');
  assert.equal(appLabel({ match: 'krita' }), 'krita');
});

// A provider that answers whatever the test sets
const fakeProvider = (overrides = {}) => ({
  name: 'fake', available: () => true, current: photoshop,
  active: async function () { return this.current; },
  openWindows: async () => [photoshop, { ...photoshop, title: 'other window' }, { exe: 'Spotify.exe', name: 'Spotify', title: 's', path: 'C:\\S\\Spotify.exe' }],
  ...overrides,
});

test('check passes when any entry matches and reports the detected program otherwise', async () => {
  const p = fakeProvider();
  const f = createFocus({ providers: [p], cacheMs: 0 });
  assert.deepEqual(await f.check([{ exe: 'gimp.exe' }, { match: 'photoshop' }]), { ok: true });
  p.current = { exe: 'Spotify.exe', name: 'Spotify', title: 'Song', path: 'C:\\S\\Spotify.exe' };
  assert.deepEqual(await f.check([{ exe: 'photoshop.exe' }]), {
    ok: false, reason: 'wrong-app', active: 'Spotify (Spotify.exe)',
    app: { exe: 'Spotify.exe', name: 'Spotify', path: 'C:\\S\\Spotify.exe' },
  });
});

test('check fails closed when detection fails, and title-only detection offers no program', async () => {
  const broken = createFocus({ providers: [fakeProvider({ active: async () => { throw new Error('no'); } })], cacheMs: 0 });
  assert.deepEqual(await broken.check([{ match: 'x' }]), { ok: false, reason: 'unknown', active: '' });
  const titles = createFocus({ providers: [fakeProvider({ active: async () => ({ exe: '', name: '', title: 'Some window', path: '' }) })], cacheMs: 0 });
  assert.deepEqual(await titles.check([{ match: 'photoshop' }]), { ok: false, reason: 'wrong-app', active: 'Some window', app: null });
});

test('the first available provider is used', async () => {
  const unavailable = fakeProvider({ name: 'nope', available: () => false });
  const f = createFocus({ providers: [unavailable, fakeProvider({ name: 'second' })] });
  assert.equal(f.providerName(), 'second');
});

test('open apps are listed once per executable, sorted by name', async () => {
  const f = createFocus({ providers: [fakeProvider()] });
  assert.deepEqual((await f.openApps()).map((a) => a.exe), ['Photoshop.exe', 'Spotify.exe']);
  const noList = createFocus({ providers: [fakeProvider({ openWindows: null })] });
  assert.equal(await noList.openApps(), null);
});
