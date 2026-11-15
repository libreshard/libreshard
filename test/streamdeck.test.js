// Importing Stream Deck profiles (streamdeck.js, streamdeck-keys.js) with synthetic profiles made
// here: formats 3.0 and 2.0, folders (nested and in a cycle), missing pages, hostile paths, the key
// tables and the summary's counts. Real profiles never enter the repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sd = require('../streamdeck');
const { entryToCombo, sourceSystem } = require('../streamdeck-keys');
const { validatePanel } = require('../panel-format');
const { makeZip } = require('./zip');

const EMPTY = { KeyModifiers: 0, QTKeyCode: 33554431, VKeyCode: -1 };
const hk = (qt, vk = -1, mods = 0) => ({ KeyModifiers: mods, QTKeyCode: qt, VKeyCode: vk });
const slots = (...entries) => [...entries, EMPTY, EMPTY, EMPTY, EMPTY].slice(0, 4);
const action = (uuid, settings = {}, states = [{}], extra = {}) => ({ UUID: 'com.elgato.streamdeck.' + uuid, Name: uuid, Settings: settings, State: 0, States: states, ...extra });
const hotkey = (entry, title) => action('system.hotkey', { Hotkeys: slots(entry) }, [title ? { Title: title } : {}]);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-sd-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };

// The base32 folder names of format 2.0 (the inverse of streamdeck.js's reading)
function base32(u) {
  const bits = BigInt('0x' + u.replace(/-/g, '')).toString(2).padStart(128, '0') + '00';
  let s = '';
  for (let i = 0; i < 130; i += 5) s += '0123456789ABCDEFGHIJKLMNOPQRSTVW'[parseInt(bits.slice(i, i + 5), 2)];
  return s + 'Z';
}

// Writes a profile folder. pages: { [uuid]: { actions, name?, images?: { rel: bytes }, encoder? } }
function makeProfile(dir, { format = 3, model = '20GAA9901', osType = 'Windows', app = 'C:\\Apps\\Tool\\tool.exe', order, def = uuid(99), pages }) {
  const base = format === 3 ? path.join(dir, 'Profiles', 'ABC.sdProfile') : path.join(dir, 'ABC.sdProfile');
  if (format === 3) write(path.join(dir, 'package.json'), { AppVersion: '7.6.1', DeviceModel: model, FormatVersion: 1, OSType: osType });
  write(path.join(base, 'manifest.json'), { Name: 'My profile', AppIdentifier: app, Device: { Model: model }, Pages: { Current: def, Default: def, Pages: order }, Version: format === 3 ? '3.0' : '2.0' });
  const all = { [def]: { actions: {} }, ...pages };
  for (const [u, p] of Object.entries(all)) {
    if (p === null) continue; // listed but missing
    const folder = path.join(base, 'Profiles', format === 3 ? u.toUpperCase() : base32(u));
    const controllers = [{ Type: 'Keypad', Actions: p.actions }];
    if (p.encoder) controllers.push({ Type: 'Encoder', Actions: p.encoder });
    write(path.join(folder, 'manifest.json'), { Name: p.name || '', Icon: '', Controllers: controllers });
    for (const [rel, bytes] of Object.entries(p.images || {})) write(path.join(folder, rel), bytes);
  }
  return dir;
}

const byPos = (page) => Object.fromEntries(page.buttons.map((b) => [`${b.col},${b.row}`, b]));

test('a 3.0 profile: pages in order, keys, media, pages and folders', () => {
  const dir = tmp();
  try {
    makeProfile(dir, {
      order: [uuid(1), uuid(2)],
      pages: {
        [uuid(1)]: {
          name: 'Main',
          actions: {
            '0,0': hotkey(hk(67, 67, 2), 'Copy'),
            '1,0': hotkey(hk(65, 65, 15)),
            '2,0': hotkey(hk(51, -1, 16384)),
            '3,0': hotkey(hk(47, -1, 16384 + 131072)),
            '4,0': hotkey(hk(16777276, -1, 32768)),
            '0,1': hotkey(hk(39, -1, 1073741824)),
            '1,1': hotkey(hk(61, -1, 2147483648)),
            '2,1': hotkey(hk(16777221, -1, 16384)),
            '3,1': hotkey(hk(16777330)),
            '4,1': action('profile.openchild', { ProfileUUID: uuid(10) }, [{ Title: 'Tools\nfolder' }]),
            '4,2': action('page.next'),
          },
        },
        [uuid(2)]: {
          actions: {
            '0,0': action('system.multimedia', {}),
            '1,0': action('system.multimedia', { actionIdx: 0 }),
            '2,0': action('system.multimedia', { actionIdx: 3 }),
            '3,0': action('system.multimedia', { actionIdx: 6 }),
            '0,1': action('system.hotkeyswitch', { Hotkeys: slots(hk(65, 65), hk(68, 68)) }, [{ Title: 'A' }, { Title: 'D' }]),
            '1,1': action('system.hotkeyswitch', { Hotkeys: slots(hk(65, 65), hk(65, 65)) }),
            '2,1': action('system.hotkey', { Hotkeys: slots(hk(67, 67, 2), hk(86, 86, 2)) }),
            '3,1': action('system.text', { pastedText: 'hi' }),
            '4,1': { UUID: 'com.example.timer.start', Name: 'Start', Plugin: { Name: 'Timer', UUID: 'com.example.timer' }, States: [{}] },
            '0,2': action('page.previous'),
            '1,2': action('page.indicator'),
          },
        },
        [uuid(10)]: {
          actions: {
            '0,0': action('profile.backtoparent'),
            '1,0': action('profile.openchild', { ProfileUUID: uuid(11) }, [{ Title: 'Deeper' }]),
          },
        },
        // A folder that opens its parent again: the same page, not a loop
        [uuid(11)]: { actions: { '0,0': action('profile.openchild', { ProfileUUID: uuid(10) }) } },
      },
    });
    const r = sd.convert(dir, { target: 'win32' });
    assert.equal(r.format, 3);
    assert.equal(r.source, 'windows');
    assert.equal(r.name, 'My profile');
    assert.deepEqual(r.apps, ['tool']);
    assert.deepEqual(r.panel.grid, { cols: 5, rows: 3 });
    assert.deepEqual(r.panel.pages.map((p) => [p.id, p.name, p.folder]), [['p1', 'Main', false], ['p2', undefined, false], ['p3', undefined, true], ['p4', undefined, true]]);
    assert.equal(r.panel.pages[2].folderTitle, 'Tools folder');

    const main = byPos(r.panel.pages[0]);
    const keys = Object.fromEntries(Object.entries(main).map(([k, b]) => [k, b.key || b.page]));
    assert.deepEqual(keys, {
      '0,0': 'ctrl+c', '1,0': 'ctrl+shift+alt+win+a', '2,0': 'numpad3', '3,0': 'numpaddiv', '4,0': 'f13',
      '0,1': 'apostrophe', '1,1': 'equal', '2,1': 'numpadenter', '3,1': 'volup', '4,1': 'p3', '4,2': 'next',
    });
    assert.equal(main['0,0'].label, 'Copy');
    assert.equal(main['0,0'].labelPos, 'bottom', "the Stream Deck app's default place");

    const media = byPos(r.panel.pages[1]);
    assert.equal(media['0,0'].key, 'playpause', 'no actionIdx is the first option');
    assert.equal(media['1,0'].key, 'prev');
    assert.equal(media['2,0'].type, 'none');
    assert.equal(media['3,0'].key, 'voldown');
    assert.deepEqual([media['0,1'].type, media['0,1'].keys, media['0,1'].label, media['0,1'].alt.label], ['toggle', ['a', 'd'], 'A', 'D']);
    assert.deepEqual([media['1,1'].type, media['1,1'].key], ['press', 'a'], 'a switch with the same key twice just presses it');
    assert.equal(media['2,1'].type, 'none', 'sequences come with macros');
    assert.equal(media['0,2'].page, 'prev');

    const folder = byPos(r.panel.pages[2]);
    assert.equal(folder['0,0'].page, 'back');
    assert.equal(folder['1,0'].page, 'p4');
    assert.equal(byPos(r.panel.pages[3])['0,0'].page, 'p3');

    const reasons = Object.values(r.marks).map((m) => m.reason).sort();
    assert.deepEqual(reasons, ['pageIndicator', 'plugin', 'sequence', 'stop', 'text']);
    assert.equal(Object.values(r.marks).find((m) => m.reason === 'plugin').detail, 'Timer');
    assert.equal(r.report.buttons, 25);
    assert.equal(r.report.imported, 20);
    assert.deepEqual(r.report.notImported, { stop: 1, sequence: 1, text: 1, plugin: 1, pageIndicator: 1 });

    const v = validatePanel(sd.resolveImages(r.panel, []));
    assert.equal(v.ok, true, v.errors.join());
    assert.deepEqual(v.warnings, []);
    assert.equal(v.panel.style.theme, 'keys');
  } finally { rm(dir); }
});

test('titles keep their place, size and color; hidden titles and images', () => {
  const dir = tmp();
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const style = (o) => ({ FontFamily: '', FontSize: 12, FontStyle: '', FontUnderline: false, OutlineThickness: 2, ShowTitle: true, TitleAlignment: 'bottom', TitleColor: '#ffffff', ...o });
    makeProfile(dir, {
      model: 'VSD2/WiFi',
      order: [uuid(1)],
      pages: {
        [uuid(1)]: {
          images: { 'Images/AAA.png': png },
          actions: {
            '0,0': hotkey(hk(65, 65), 'plain'),
            '1,0': action('system.hotkey', { Hotkeys: slots(hk(66, 66)) }, [style({ Title: 'top', TitleAlignment: 'top' })]),
            '2,0': action('system.hotkey', { Hotkeys: slots(hk(67, 67)) }, [style({ Title: 'hidden', ShowTitle: false })]),
            '3,0': action('system.hotkey', { Hotkeys: slots(hk(68, 68)) }, [style({ Title: 'big', FontSize: 18, TitleColor: '#46FF25' })]),
            '4,0': action('system.hotkey', { Hotkeys: slots(hk(69, 69)) }, [style({ Title: 'small', FontSize: 8, TitleAlignment: 'middle' })]),
            '6,2': action('system.hotkey', { Hotkeys: slots(hk(70, 70)) }, [{ Image: 'Images/AAA.png' }]),
            '7,0': action('system.hotkey', { Hotkeys: slots(hk(71, 71)) }, [{ Image: '../../../outside.png' }]),
            '7,1': action('system.hotkey', { Hotkeys: slots(hk(72, 72)) }, [{ Image: 'Images/missing.png' }]),
            '7,2': action('system.hotkey', { Hotkeys: slots(hk(73, 73)) }, [{ Image: 'Images/AAA.png' }]),
          },
        },
      },
    });
    write(path.join(dir, 'outside.png'), png);
    const r = sd.convert(dir, { target: 'linux' });
    assert.deepEqual(r.panel.grid, { cols: 8, rows: 3 }, "a virtual device's size comes from its buttons");
    const b = byPos(r.panel.pages[0]);
    assert.deepEqual([b['0,0'].label, b['0,0'].labelPos, b['0,0'].labelSize, b['0,0'].textColor], ['plain', 'bottom', undefined, undefined]);
    assert.equal(b['1,0'].labelPos, 'top');
    assert.equal(b['2,0'].label, undefined);
    assert.deepEqual([b['3,0'].labelSize, b['3,0'].textColor], ['l', '#46ff25']);
    assert.deepEqual([b['4,0'].labelSize, b['4,0'].labelPos], ['s', 'middle']);
    assert.equal(r.images.length, 1, 'the same image is read once');
    assert.ok(r.images[0].endsWith(path.join('Images', 'AAA.png')));
    assert.deepEqual(b['6,2'].icon, { kind: 'image', file: 'src:0', imported: 'streamdeck' });
    assert.equal(b['7,0'].icon, undefined, 'images outside the page folder are ignored');
    assert.equal(b['7,1'].icon, undefined);

    const panel = sd.resolveImages(r.panel, ['images/aaaaaaaaaaaa.png']);
    assert.equal(byPos(panel.pages[0])['6,2'].icon.file, 'images/aaaaaaaaaaaa.png');
    assert.equal(panel.pages[0].folder, undefined);
    const v = validatePanel(panel, { files: new Set(['images/aaaaaaaaaaaa.png']) });
    assert.equal(v.ok, true);
    assert.deepEqual(v.warnings, []);
    // An image the main process couldn't read: its icons go
    assert.equal(byPos(sd.resolveImages(sd.convert(dir).panel, [null]).pages[0])['6,2'].icon, undefined);
  } finally { rm(dir); }
});

test('a 2.0 profile from a Mac: base32 folders, modifier flags, Cmd adapted to Ctrl', () => {
  const dir = tmp();
  try {
    const mac = (qt, vk, flags) => ({ KeyCmd: false, KeyCtrl: false, KeyOption: false, KeyShift: false, KeyModifiers: 0, NativeCode: vk, QTKeyCode: qt, VKeyCode: vk, ...flags });
    makeProfile(dir, {
      format: 2, model: '20GAT9901', app: '/Applications/Affinity Photo.app',
      order: [uuid(1)],
      pages: {
        [uuid(1)]: {
          actions: {
            '0,0': action('system.hotkey', { Hotkeys: slots(mac(83, 1, { KeyCmd: true })) }),
            '1,0': action('system.hotkey', { Hotkeys: slots(mac(90, 6, { KeyCmd: true, KeyShift: true })) }),
            '2,0': action('system.hotkey', { Hotkeys: slots(mac(51, 85, {})) }), // keypad 3
            '3,0': action('system.hotkey', { Hotkeys: slots(mac(72, 17, {})) }), // Qt says H, the Mac code says T
          },
          encoder: { '0,0': action('system.multimedia', { actionIdx: 5 }) },
        },
      },
    });
    assert.equal(sd.base32Uuid(base32(uuid(1))), uuid(1));
    const r = sd.convert(dir, { target: 'win32' });
    assert.equal(r.format, 2);
    assert.equal(r.source, 'mac');
    assert.deepEqual(r.apps, ['affinity photo']);
    assert.deepEqual(r.panel.grid, { cols: 8, rows: 4 });
    const b = byPos(r.panel.pages[0]);
    assert.deepEqual([b['0,0'].key, b['1,0'].key, b['2,0'].key, b['3,0'].key], ['ctrl+s', 'ctrl+shift+z', 'numpad3', 'h']);
    assert.deepEqual(r.report.adapted, { mac: 2 });
    assert.equal(r.report.review, 1);
    assert.equal(r.report.dials, 1);
    assert.deepEqual(Object.values(r.marks).map((m) => m.kind), ['check', 'check', 'check']);
    assert.equal(byPos(sd.convert(dir, { target: 'darwin' }).panel.pages[0])['0,0'].key, 'cmd+s', 'on a Mac it stays Cmd');
  } finally { rm(dir); }
});

test('missing pages, a folder that is not there, an empty Default page and Key Logic', () => {
  const dir = tmp();
  try {
    makeProfile(dir, {
      order: [uuid(1), uuid(2)],
      def: uuid(5),
      pages: {
        [uuid(1)]: {
          actions: {
            '0,0': action('profile.openchild', { ProfileUUID: uuid(42) }),
            '1,0': action('keys.logic', {}, [{}], { Actions: [hotkey(hk(83, 83)), hotkey(hk(83, 83, 1)), { Actions: [] }] }),
            '2,0': action('keys.logic', {}, [{}], { Actions: [{ Actions: [] }, { Actions: [] }, { Actions: [] }] }),
            '3,0': action('keys.logic', {}, [{}], { Actions: [{ Actions: [hotkey(hk(84, 84))] }] }),
            '30,0': hotkey(hk(65, 65)),
          },
        },
        [uuid(2)]: null,
        [uuid(5)]: { actions: {} },
      },
    });
    const r = sd.convert(dir);
    assert.deepEqual(r.panel.pages.map((p) => p.id), ['p1']);
    assert.equal(r.report.missingPages, 1);
    const b = byPos(r.panel.pages[0]);
    assert.equal(b['0,0'].type, 'none');
    assert.equal(r.marks[b['0,0'].id].reason, 'missingPage');
    assert.equal(b['1,0'].key, 's', 'Key Logic: the single press');
    assert.equal(r.marks[b['1,0'].id].reason, 'keyLogic');
    assert.equal(r.marks[b['2,0'].id].reason, 'keyLogicEmpty');
    assert.equal(b['3,0'].key, 't');
    assert.equal(r.marks[b['3,0'].id], undefined, 'nothing else to mention');
    assert.equal(b['30,0'], undefined);
    assert.deepEqual(r.report.notImported, { missingPage: 1, keyLogicEmpty: 1, outside: 1 });
  } finally { rm(dir); }
});

test('what is not a usable profile says why', () => {
  const dir = tmp();
  const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
  try {
    assert.equal(code(() => sd.convert(dir)), 'notProfile');
    write(path.join(dir, 'manifest.json'), { Actions: {} });
    assert.equal(code(() => sd.convert(dir)), 'oldFormat');
    rm(dir);
    makeProfile(dir, { order: [], pages: {} });
    assert.equal(code(() => sd.convert(dir)), 'empty', 'only an empty Default page');
    write(path.join(dir, 'Profiles', 'ABC.sdProfile', 'manifest.json'), '{ not json');
    assert.equal(code(() => sd.convert(dir)), 'invalid');
  } finally { rm(dir); }
});

test('readProfile goes through the safe zip extraction and cleans up after itself', async () => {
  const src = tmp();
  const out = tmp();
  try {
    makeProfile(src, { order: [uuid(1)], pages: { [uuid(1)]: { actions: { '0,0': hotkey(hk(65, 65)) } } } });
    const entries = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else entries.push({ name: path.relative(src, f).split(path.sep).join('/'), data: fs.readFileSync(f) }); } };
    walk(src);
    const good = path.join(out, 'good.streamDeckProfile');
    fs.writeFileSync(good, makeZip(entries));
    const r = await sd.readProfile(good);
    assert.equal(r.panel.pages[0].buttons[0].key, 'a');
    r.cleanup();

    const evil = path.join(out, 'evil.streamDeckProfile');
    fs.writeFileSync(evil, makeZip([...entries, { name: '../evil.txt', data: 'x' }]));
    await assert.rejects(sd.readProfile(evil), (e) => e.code === 'notZip');
    fs.writeFileSync(path.join(out, 'junk.streamDeckProfile'), 'not a zip');
    await assert.rejects(sd.readProfile(path.join(out, 'junk.streamDeckProfile')), (e) => e.code === 'notZip');
  } finally { rm(src); rm(out); }
});

test('the key tables', () => {
  const win = { source: 'windows', target: 'win32' };
  assert.equal(entryToCombo(EMPTY, win), null);
  assert.deepEqual(entryToCombo(hk(65, 65, 1), win), { combo: 'shift+a' });
  assert.deepEqual(entryToCombo(hk(65, 65, 4), win), { combo: 'alt+a' });
  assert.deepEqual(entryToCombo(hk(65, 65, 8), win), { combo: 'win+a' });
  assert.deepEqual(entryToCombo(hk(65, 65, 8), { source: 'windows', target: 'darwin' }), { combo: 'cmd+a' });
  assert.deepEqual(entryToCombo(hk(16777232, 36), win), { combo: 'home' });
  assert.deepEqual(entryToCombo(hk(43, 107), win), { combo: 'numpadplus' });
  assert.deepEqual(entryToCombo(hk(51, 99), win), { combo: 'numpad3' }, 'format 2.0: the keypad from the VK');
  assert.deepEqual(entryToCombo(hk(45, 109), win), { combo: 'numpadminus' });
  assert.deepEqual(entryToCombo(hk(16777287, -1, 32768), win), { combo: 'f24' });
  assert.deepEqual(entryToCombo(hk(96, -1, 1073741824), win), { combo: 'grave' });
  assert.deepEqual(entryToCombo(hk(16777344), win), { combo: 'playpause' });
  assert.deepEqual(entryToCombo(hk(16908293), win), { combo: 'playpause' });
  assert.deepEqual(entryToCombo(hk(16777345), win), { unsupported: 'stop' });
  assert.deepEqual(entryToCombo(hk(16777224), win), { unsupported: 'pause' });
  assert.deepEqual(entryToCombo(hk(16777227, -1, 16384), win), { unsupported: 'clear' });
  assert.deepEqual(entryToCombo(hk(16777249, 17, 2), win), { combo: 'ctrl' }, 'a modifier on its own');
  assert.deepEqual(entryToCombo(hk(33554431, 113), { source: 'unknown' }), { combo: 'f2', review: true });

  assert.equal(sourceSystem({ osType: 'Windows' }), 'windows');
  assert.equal(sourceSystem({ osType: 'macOS' }), 'mac');
  assert.equal(sourceSystem({ appIdentifier: 'C:\\x\\y.exe' }), 'windows');
  assert.equal(sourceSystem({ appIdentifier: '/Applications/X.app' }), 'mac');
  assert.equal(sourceSystem({ appIdentifier: '*' }), 'unknown');
  assert.deepEqual(sd.appsFor('*'), []);
  assert.deepEqual(sd.appsFor('C:\\Program Files\\Notepad++\\notepad++.exe'), ['notepad++']);
});

test('every reason the import gives has its texts in both languages', () => {
  for (const lang of ['en', 'es']) {
    const strings = require(`../i18n/${lang}.json`);
    for (const r of [...sd.REASONS.none, ...sd.REASONS.check, ...sd.REASONS.uncounted]) assert.ok(strings['import.short.' + r], `${lang} import.short.${r}`);
    for (const r of sd.REASONS.none) assert.ok(strings['import.reason.' + r], `${lang} import.reason.${r}`);
  }
});
