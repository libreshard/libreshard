// Panels made with the editor: panel.json validation, the keys and images a panel uses, and the
// shard folder generated from it (which must install like any other shard).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { validatePanel, keysOf, imagesOf, buildShard, panelId, nextVersion, LIMITS } = require('../panel-format');
const { validateManifest } = require('../manifest');
const installer = require('../installer');
const { PANEL_TEMPLATE } = require('../tools/build-shard-base');

const btn = (o) => ({ col: 0, row: 0, type: 'press', key: 'f13', ...o });
const panelWith = (buttons, extra = {}) => ({ format: 1, grid: { cols: 5, rows: 3 }, pages: [{ id: 'p1', name: 'Main', buttons }], ...extra });

// One of everything the format allows
const FULL = {
  format: 1,
  grid: { cols: 5, rows: 3 },
  pageBar: true,
  style: {
    theme: 'keys',
    background: { kind: 'gradient', colors: ['#0d1b2a', '#133452'] },
    button: { radius: 18, border: 1, borderColor: '#29486a', fill: 'gradient', shadow: false, color: '#1a3150', activeColor: '#22d3ee', imageFit: 'bleed' },
    spacing: 'wide',
    text: { color: '#e6eef7', size: 'l', font: 'mono' },
  },
  pages: [
    {
      id: 'p1', name: 'Main', layout: 'grid',
      buttons: [
        { id: 'copy', col: 0, row: 0, w: 1, h: 1, type: 'press', key: 'ctrl+c', label: 'Copy', labelPos: 'bottom', labelSize: 'm', icon: { kind: 'builtin', name: 'copy' }, color: '#1a3150', textColor: '#e6eef7' },
        { id: 'alt', col: 1, row: 0, w: 1, h: 1, type: 'hold', key: 'alt' },
        { id: 'vol', col: 2, row: 0, w: 1, h: 1, type: 'repeat', key: 'volup', repeat: 200, icon: { kind: 'emoji', text: '🔊' } },
        { id: 'mic', col: 3, row: 0, w: 2, h: 2, type: 'toggle', keys: ['f14', 'f15'], label: 'Mic on', icon: { kind: 'image', file: 'images/0123456789ab.png', imported: 'streamdeck' }, alt: { label: 'Mic off', color: '#7f1d1d' } },
        { id: 'go2', col: 0, row: 1, w: 1, h: 1, type: 'page', page: 'p2', label: 'More' },
        { id: 'title', col: 0, row: 2, w: 3, h: 1, type: 'label', label: 'Streaming\ntools' },
        { id: 'web', col: 3, row: 2, w: 1, h: 1, type: 'none', label: 'Website', note: 'Opening websites is not supported' },
      ],
    },
    { id: 'p2', name: 'More', layout: 'grid', buttons: [{ id: 'back', col: 0, row: 0, w: 1, h: 1, type: 'page', page: 'back' }] },
  ],
};

test('a complete panel is valid, keeps everything and validates to itself again', () => {
  const r = validatePanel(FULL, { files: new Set(['images/0123456789ab.png']) });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.panel, FULL);
  assert.deepEqual(validatePanel(r.panel).panel, r.panel);
});

test('defaults: missing layout, size and repeat are filled in; unknown fields are dropped', () => {
  const r = validatePanel({
    format: 1, grid: { cols: 2, rows: 2 }, extra: 1,
    pages: [{ id: 'p1', script: 'x', buttons: [{ id: 'r', col: 0, row: 0, type: 'repeat', key: 'VolUp', onclick: 'alert(1)' }] }],
  });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.panel, {
    format: 1, grid: { cols: 2, rows: 2 },
    pages: [{ id: 'p1', name: '1', layout: 'grid', buttons: [{ id: 'r', col: 0, row: 0, w: 1, h: 1, type: 'repeat', key: 'volup', repeat: 100 }] }],
  });
});

test('problems with the panel as a whole make it invalid', () => {
  const bad = (raw, re) => {
    const r = validatePanel(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.panel, null);
    assert.match(r.errors.join(' '), re);
  };
  bad(null, /object/);
  bad([], /object/);
  bad({ ...panelWith([]), format: 2 }, /newer version/);
  bad({ ...panelWith([]), format: '1' }, /format/);
  bad({ ...panelWith([]), grid: { cols: 0, rows: 3 } }, /grid/);
  bad({ ...panelWith([]), grid: { cols: 25, rows: 3 } }, /grid/);
  bad({ ...panelWith([]), grid: { cols: 2.5, rows: 3 } }, /grid/);
  bad({ ...panelWith([]), pages: [] }, /pages/);
  bad({ ...panelWith([]), pages: Array.from({ length: 51 }, (_, i) => ({ id: 'p' + i })) }, /50 pages/);
  bad({ ...panelWith([]), pages: [{ id: 'p1', layout: 'free' }] }, /newer version/);
  bad({ ...panelWith([]), pages: [{ id: 'p1' }, { id: 'p1' }] }, /unique/);
  bad({ ...panelWith([]), pages: [{ id: '../x' }] }, /unique/);
});

test('a button outside the grid, too big or overlapping another is dropped', () => {
  const r = validatePanel(panelWith([
    btn({ id: 'a', col: 0, row: 0, w: 2, h: 2 }),
    btn({ id: 'b', col: 1, row: 1 }), // inside a
    btn({ id: 'c', col: 5, row: 0 }), // the grid has columns 0–4
    btn({ id: 'd', col: 4, row: 0, w: 2 }), // spills out
    btn({ id: 'e', col: -1, row: 0 }),
    btn({ id: 'f', col: 2, row: 2 }),
    'nope',
  ]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.panel.pages[0].buttons.map((b) => b.id), ['a', 'f']);
  assert.equal(r.warnings.length, 5);
});

test('an action that cannot work becomes a button without action, keeping its look', () => {
  const r = validatePanel(panelWith([
    btn({ id: 'k', key: 'ctrl+nosuchkey', label: 'Bad key' }),
    btn({ id: 't', col: 1, type: 'toggle', keys: ['f13'], label: 'One key' }),
    btn({ id: 'p', col: 2, type: 'page', page: 'missing', label: 'Nowhere' }),
    btn({ id: 'u', col: 3, type: 'launch', label: 'Unknown type' }),
  ]));
  assert.deepEqual(r.panel.pages[0].buttons.map((b) => [b.type, b.label, b.key, b.keys, b.page]), [
    ['none', 'Bad key', undefined, undefined, undefined],
    ['none', 'One key', undefined, undefined, undefined],
    ['none', 'Nowhere', undefined, undefined, undefined],
    ['none', 'Unknown type', undefined, undefined, undefined],
  ]);
  assert.equal(r.warnings.length, 4);
});

test('texts, emoji, colors and repeat values are cleaned', () => {
  const long = 'x'.repeat(100);
  const r = validatePanel(panelWith([
    btn({ id: 'a', label: ' \u0000Hi\u0007\r\nthere ', color: '#ABCDEF', textColor: 'red', labelPos: 'left', labelSize: 'xl' }),
    btn({ id: 'b', col: 1, label: long, icon: { kind: 'emoji', text: '👍🏽🇲🇽🎉x' } }),
    btn({ id: 'c', col: 2, type: 'repeat', repeat: 10 }),
    btn({ id: 'd', col: 3, icon: { kind: 'builtin', name: '<b>' } }),
    btn({ id: 'e', col: 4, icon: { kind: 'emoji', text: '   ' }, alt: { label: 'only for toggles' } }),
  ]));
  const [a, b, c, d, e] = r.panel.pages[0].buttons;
  assert.equal(a.label, 'Hi\nthere');
  assert.equal(a.color, '#abcdef');
  assert.equal(a.textColor, undefined);
  assert.equal(a.labelPos, undefined);
  assert.equal(a.labelSize, undefined);
  assert.equal([...b.label].length, LIMITS.text);
  assert.deepEqual(b.icon, { kind: 'emoji', text: '👍🏽🇲🇽' });
  assert.equal(c.repeat, 100);
  assert.equal(d.icon, undefined);
  assert.equal(e.icon, undefined);
  assert.equal(e.alt, undefined);
});

test('images must be under images/, named like the app names them and present', () => {
  const icon = (file) => btn({ icon: { kind: 'image', file } });
  const files = new Set(['images/0123456789ab.png']);
  const iconOf = (file, opts) => validatePanel(panelWith([icon(file)]), opts).panel.pages[0].buttons[0].icon;
  assert.deepEqual(iconOf('images/0123456789ab.png', { files }), { kind: 'image', file: 'images/0123456789ab.png' });
  assert.equal(iconOf('images/fffffffffff0.png', { files }), undefined, 'missing file');
  assert.deepEqual(iconOf('images/fffffffffff0.png'), { kind: 'image', file: 'images/fffffffffff0.png' }, 'without files only the name is checked');
  for (const bad of ['images/../manifest.json', '../images/a.png', 'images/a.svg', 'images/sub/a.png', '/images/a.png', 'images\\a.png', 'https://x/a.png']) {
    assert.equal(iconOf(bad), undefined, bad);
  }
});

test('button ids that are missing, invalid or repeated get a new unique one', () => {
  const r = validatePanel({
    format: 1, grid: { cols: 4, rows: 1 },
    pages: [
      { id: 'p1', buttons: [btn({ id: 'b2' }), btn({ col: 1 }), btn({ col: 2, id: 'b2' })] },
      { id: 'p2', buttons: [btn({ id: '<x>' })] },
    ],
  });
  const ids = r.panel.pages.flatMap((p) => p.buttons.map((b) => b.id));
  assert.equal(ids[0], 'b2');
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => /^b\d+$/.test(id)));
});

test('style values are checked one by one: bad ones are dropped, good ones stay', () => {
  const r = validatePanel(panelWith([], {
    style: {
      theme: 'streamdeck',
      background: { kind: 'image', file: 'images/../x.png' },
      button: { radius: 99, border: 2, borderColor: 'blue', fill: 'flat', shadow: 'yes', imageFit: 'bleed' },
      spacing: 'huge',
      text: { color: '#ffffff', size: 'xxl', font: 'comic' },
      css: 'body { display: none }',
    },
  }));
  assert.deepEqual(r.panel.style, { button: { border: 2, fill: 'flat', imageFit: 'bleed' }, text: { color: '#ffffff' } });
  assert.equal(r.warnings.length, 8);

  const bg = (background, files) => validatePanel(panelWith([], { style: { background } }), { files }).panel.style?.background;
  assert.deepEqual(bg({ kind: 'color', color: '#000000' }), { kind: 'color', color: '#000000' });
  assert.deepEqual(bg({ kind: 'image', file: 'images/abc.png', dim: 40 }, new Set(['images/abc.png'])), { kind: 'image', file: 'images/abc.png', dim: 40 });
  assert.deepEqual(bg({ kind: 'image', file: 'images/abc.png', dim: 90 }), { kind: 'image', file: 'images/abc.png' });
  assert.equal(bg({ kind: 'gradient', colors: ['#000000'] }), undefined);
  assert.equal(bg({ kind: 'image', file: 'images/abc.png' }, new Set()), undefined);
});

test(`a panel can use at most ${LIMITS.keys} different keys (the manifest limit)`, () => {
  const keyFor = (i) => ['', 'ctrl+', 'shift+', 'alt+', 'ctrl+shift+', 'ctrl+alt+', 'shift+alt+', 'ctrl+shift+alt+'][Math.floor(i / 24) % 8] +
    (Math.floor(i / 192) ? 'win+' : '') + 'f' + ((i % 24) + 1);
  const page = (from, n) => Array.from({ length: n }, (_, i) => btn({ col: i % 24, row: Math.floor(i / 24), key: keyFor(from + i) }));
  const ok = validatePanel({ format: 1, grid: { cols: 24, rows: 24 }, pages: [{ id: 'p1', buttons: page(0, 300) }] });
  assert.equal(ok.ok, true);
  assert.equal(keysOf(ok.panel).length, 300);
  const tooMany = validatePanel({ format: 1, grid: { cols: 24, rows: 24 }, pages: [{ id: 'p1', buttons: page(0, 300) }, { id: 'p2', buttons: page(300, 1) }] });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors[0], /301 different keys/);
});

test('keysOf lists each key once, normalized; imagesOf finds every image', () => {
  const { panel } = validatePanel(FULL);
  assert.deepEqual(keysOf(panel), ['ctrl+c', 'alt', 'volup', 'f14', 'f15']);
  assert.deepEqual(keysOf(validatePanel(panelWith([btn({ key: 'Ctrl + C' }), btn({ col: 1, key: 'ctrl+c' })])).panel), ['ctrl+c']);
  const withBg = validatePanel({ ...FULL, style: { background: { kind: 'image', file: 'images/bg.png' } } }).panel;
  assert.deepEqual(imagesOf(withBg), ['images/0123456789ab.png', 'images/bg.png']);
});

test('panel ids: ASCII slug of the name, never over 64 characters, valid as a manifest id', () => {
  assert.equal(panelId('Diseño de Sonido', 'ab12'), 'panel-diseno-de-sonido-ab12');
  assert.equal(panelId('  !!!  ', 'ab12'), 'panel-panel-ab12');
  assert.equal(panelId('', 'ab12'), 'panel-panel-ab12');
  assert.equal(panelId('日本語', 'ab12'), 'panel-panel-ab12');
  const long = panelId('a very long name '.repeat(10), 'ab12');
  assert.ok(long.length <= 64, long);
  assert.match(long, /^panel-a-very-long-name-[a-z-]*[a-z]-ab12$/);
  assert.match(panelId('x'), /^panel-x-[0-9a-f]{4}$/);
  for (const id of [long, panelId('Diseño'), panelId('')]) assert.equal(validateManifest({ id }).ok, true, id);
});

test('nextVersion raises the patch number, or starts at 1.0.0', () => {
  assert.equal(nextVersion('1.0.4'), '1.0.5');
  assert.equal(nextVersion('2.3.9'), '2.3.10');
  assert.equal(nextVersion('1.0'), '1.0.0');
  assert.equal(nextVersion(undefined), '1.0.0');
});

test('buildShard writes a valid manifest and a layout.js that cannot break out of its script', () => {
  const hostile = panelWith([btn({ label: '</script><script>alert(1)</script>\u2028x', key: 'ctrl+c' })]);
  const { panel } = validatePanel(hostile);
  const { manifest, files } = buildShard({ panel, meta: { name: 'Mi panel </script>', icon: '🎛️', apps: ['obs64.exe'] } });
  assert.match(manifest.id, /^panel-mi-panel-script-[0-9a-f]{4}$/);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.minAppVersion, '0.4.0');
  assert.deepEqual(manifest.permissions.keys, ['ctrl+c']);
  const checked = validateManifest(JSON.parse(files['manifest.json']), { appVersion: '0.4.0' });
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.manifest.apps, ['obs64.exe']);
  assert.deepEqual(JSON.parse(files['panel.json']), panel);

  assert.ok(!/<\/script/i.test(files['layout.js']));
  assert.ok(!files['layout.js'].includes('\u2028'));
  const sandbox = { window: {} };
  vm.runInNewContext(files['layout.js'], sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.LS_PANEL)), panel);
  assert.equal(sandbox.window.LS_PANEL_NAME, 'Mi panel </script>');
});

test('saving an existing panel keeps its id and manifest details and raises the version', () => {
  const { panel } = validatePanel(FULL);
  const meta = { id: 'panel-obs-1a2b', name: 'OBS', author: 'Ana', version: '1.0.7', description: 'Scenes', apps: ['obs64.exe'] };
  const { manifest } = buildShard({ panel, meta });
  assert.equal(manifest.id, 'panel-obs-1a2b');
  assert.equal(manifest.version, '1.0.8');
  assert.equal(manifest.author, 'Ana');
  assert.equal(manifest.description, 'Scenes');
  assert.deepEqual(manifest.apps, ['obs64.exe']);
});

test('a generated panel folder with the template passes the install review', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-panel-test-'));
  try {
    const template = {};
    for (const name of fs.readdirSync(PANEL_TEMPLATE)) template[name] = fs.readFileSync(path.join(PANEL_TEMPLATE, name), 'utf8');
    assert.deepEqual(Object.keys(template).sort(), ['index.html', 'libreshard.css', 'libreshard.js', 'panel.js']);
    const { panel } = validatePanel(FULL);
    const { manifest, files } = buildShard({ panel, meta: { name: 'Stream' }, template });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const r = installer.describe(dir, { appVersion: '0.4.0' });
    assert.deepEqual(r.errors, undefined);
    assert.equal(r.manifest.id, manifest.id);
    assert.deepEqual(r.manifest.keys, ['ctrl+c', 'alt', 'volup', 'f14', 'f15']);
    assert.equal(installer.describe(dir, { appVersion: '0.3.0' }).ok, false, 'older apps refuse panels');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
