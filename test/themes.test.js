// The built-in panel themes (shard-base/themes.js): valid values, how a panel's settings combine
// with its theme's, and the contrast check the editor warns with.
const test = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, NAMES, resolve, contrast } = require('../shard-base/themes');
const { validatePanel } = require('../panel-format');

const COLOR = /^#[0-9a-f]{6}$/;
const panelWithStyle = (style) => ({ format: 1, grid: { cols: 2, rows: 2 }, style, pages: [{ id: 'p1', buttons: [] }] });

test('the themes are the five panel.json accepts, with valid base colors', () => {
  assert.deepEqual(NAMES, ['libreshard', 'light', 'contrast', 'oled', 'keys']);
  for (const name of NAMES) {
    const th = THEMES[name];
    assert.ok(['dark', 'light'].includes(th.scheme), name);
    for (const [k, v] of Object.entries(th.vars)) {
      assert.match(k, /^--ls-[a-z]+$/, `${name} ${k}`);
      assert.match(v, COLOR, `${name} ${k}`);
    }
    assert.ok(validatePanel(panelWithStyle({ theme: name })).ok, name);
  }
});

test("every theme's settings are valid panel.json style values", () => {
  for (const name of NAMES) {
    const { style } = resolve({ theme: name });
    const r = validatePanel(panelWithStyle(style));
    assert.deepEqual(r.warnings, [], name);
    assert.deepEqual(r.panel.style, style, `${name} keeps every value`);
  }
});

test("a panel's own settings go over its theme's; an unknown theme is LibreShard's", () => {
  const r = resolve({ theme: 'oled', button: { radius: 4 }, text: { font: 'mono' } });
  assert.equal(r.name, 'oled');
  assert.equal(r.vars['--ls-navy'], '#000000');
  assert.equal(r.style.button.radius, 4);
  assert.equal(r.style.button.color, THEMES.oled.style.button.color, 'the rest of the group stays');
  assert.equal(r.style.text.font, 'mono');
  assert.equal(r.style.text.color, THEMES.oled.style.text.color);
  assert.deepEqual(resolve({ theme: 'oled', tabs: { activeColor: '#ff0000' } }).style.tabs, { ...THEMES.oled.style.tabs, activeColor: '#ff0000' });
  assert.deepEqual(r.style.background, { kind: 'color', color: '#000000' });

  const own = resolve({ theme: 'light', background: { kind: 'color', color: '#123456' } });
  assert.deepEqual(own.style.background, { kind: 'color', color: '#123456' });

  for (const style of [undefined, {}, { theme: 'streamdeck' }]) {
    const d = resolve(style);
    assert.equal(d.name, 'libreshard');
    assert.equal(d.style.background, undefined, "LibreShard's own background stays in the base styles");
  }
});

test('contrast follows WCAG, and every theme keeps its text readable on its buttons', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'));
  for (const name of NAMES) {
    const { style } = resolve({ theme: name });
    assert.ok(contrast(style.text.color, style.button.color) >= 4.5, name);
    assert.ok(contrast(style.tabs.activeTextColor, style.tabs.activeColor) >= 4.5, name + ' selected tab');
  }
});
