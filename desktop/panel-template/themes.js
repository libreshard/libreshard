// SPDX-License-Identifier: MIT-0
// The built-in looks for panels made with LibreShard's editor. A theme is a set of base colors (the
// --ls-* variables every shard style uses) plus default panel settings, in the same shape as
// panel.json's "style". A panel's own settings go on top of its theme's (resolve()), group by group
// for the buttons, the page tabs and the text.
// Used by panel.js on the tablet and by the editor (as window.LS_THEMES), and by the tests.
(() => {
  const DARK = {
    '--ls-navy': '#0d1b2a', '--ls-surface': '#12233a', '--ls-raised': '#1a3150', '--ls-line': '#29486a',
    '--ls-cyan': '#22d3ee', '--ls-gold': '#fbbf24', '--ls-red': '#f87171', '--ls-text': '#e6eef7', '--ls-muted': '#8ea6bf',
  };

  const THEMES = {
    // Today's look: no background setting, so the base styles' navy with its glow stays
    libreshard: {
      scheme: 'dark',
      vars: DARK,
      style: {
        button: { radius: 18, border: 1, borderColor: '#29486a', fill: 'gradient', shadow: false, color: '#1a3150', activeColor: '#22d3ee', imageFit: 'inset' },
        tabs: { radius: 20, fill: 'none', color: '#1a3150', textColor: '#8ea6bf', borderColor: '#29486a', activeColor: '#1a3150', activeTextColor: '#e6eef7', activeBorderColor: '#22d3ee' },
        spacing: 'normal',
        text: { color: '#e6eef7', size: 'm', font: 'system' },
      },
    },
    light: {
      scheme: 'light',
      vars: {
        '--ls-navy': '#eef2f7', '--ls-surface': '#ffffff', '--ls-raised': '#f6f8fb', '--ls-line': '#c3cfdd',
        '--ls-cyan': '#0e7490', '--ls-gold': '#b45309', '--ls-red': '#b91c1c', '--ls-text': '#0f172a', '--ls-muted': '#475569',
      },
      style: {
        background: { kind: 'gradient', colors: ['#f4f7fb', '#dde6f0'] },
        button: { radius: 16, border: 1, borderColor: '#c3cfdd', fill: 'gradient', shadow: true, color: '#ffffff', activeColor: '#0e7490', imageFit: 'inset' },
        tabs: { radius: 20, fill: 'none', color: '#ffffff', textColor: '#475569', borderColor: '#c3cfdd', activeColor: '#ffffff', activeTextColor: '#0f172a', activeBorderColor: '#0e7490' },
        spacing: 'normal',
        text: { color: '#0f172a', size: 'm', font: 'system' },
      },
    },
    // Accessibility: pure black and white, yellow when pressed, thick borders, larger text
    contrast: {
      scheme: 'dark',
      vars: {
        '--ls-navy': '#000000', '--ls-surface': '#000000', '--ls-raised': '#000000', '--ls-line': '#ffffff',
        '--ls-cyan': '#ffff00', '--ls-gold': '#ffff00', '--ls-red': '#ff6b6b', '--ls-text': '#ffffff', '--ls-muted': '#ffffff',
      },
      style: {
        background: { kind: 'color', color: '#000000' },
        button: { radius: 10, border: 3, borderColor: '#ffffff', fill: 'flat', shadow: false, color: '#000000', activeColor: '#ffff00', imageFit: 'inset' },
        tabs: { radius: 8, fill: 'flat', color: '#000000', textColor: '#ffffff', borderColor: '#ffffff', activeColor: '#ffff00', activeTextColor: '#000000', activeBorderColor: '#ffff00' },
        spacing: 'normal',
        text: { color: '#ffffff', size: 'l', font: 'system' },
      },
    },
    // Pure black saves battery on OLED screens
    oled: {
      scheme: 'dark',
      vars: { ...DARK, '--ls-navy': '#000000', '--ls-surface': '#000000', '--ls-raised': '#0d0d0d', '--ls-line': '#262626' },
      style: {
        background: { kind: 'color', color: '#000000' },
        button: { radius: 18, border: 1, borderColor: '#262626', fill: 'flat', shadow: false, color: '#0d0d0d', activeColor: '#22d3ee', imageFit: 'inset' },
        tabs: { radius: 20, fill: 'none', color: '#0d0d0d', textColor: '#8ea6bf', borderColor: '#262626', activeColor: '#0d0d0d', activeTextColor: '#e6eef7', activeBorderColor: '#22d3ee' },
        spacing: 'normal',
        text: { color: '#e6eef7', size: 'm', font: 'system' },
      },
    },
    // A hardware key pad: black, square-ish keys, no borders, images to the edge (the importer's default)
    keys: {
      scheme: 'dark',
      vars: { ...DARK, '--ls-navy': '#000000', '--ls-surface': '#141414', '--ls-raised': '#1c1c1c', '--ls-line': '#2a2a2a', '--ls-cyan': '#f5f5f5' },
      style: {
        background: { kind: 'color', color: '#000000' },
        button: { radius: 8, border: 0, borderColor: '#2a2a2a', fill: 'flat', shadow: false, color: '#1c1c1c', activeColor: '#f5f5f5', imageFit: 'bleed' },
        tabs: { radius: 6, fill: 'flat', color: '#141414', textColor: '#9a9a9a', borderColor: '#141414', activeColor: '#f5f5f5', activeTextColor: '#000000', activeBorderColor: '#f5f5f5' },
        spacing: 'compact',
        text: { color: '#ffffff', size: 'm', font: 'system' },
      },
    },
  };
  const NAMES = Object.keys(THEMES);

  // The look a panel ends up with: its theme's base colors, and its theme's settings with the
  // panel's own on top. An unknown or missing theme is LibreShard's.
  function resolve(style) {
    const s = style || {};
    const theme = THEMES[s.theme] || THEMES.libreshard;
    const merged = {
      ...theme.style,
      ...s,
      button: { ...theme.style.button, ...(s.button || {}) },
      tabs: { ...theme.style.tabs, ...(s.tabs || {}) },
      text: { ...theme.style.text, ...(s.text || {}) },
    };
    if (!s.background) { if (theme.style.background) merged.background = theme.style.background; else delete merged.background; }
    merged.theme = THEMES[s.theme] ? s.theme : 'libreshard';
    return { name: merged.theme, scheme: theme.scheme, vars: theme.vars, style: merged };
  }

  // WCAG contrast ratio between two #rrggbb colors (1 to 21; 4.5 is the minimum for normal text)
  function contrast(a, b) {
    const lum = (hex) => {
      const [r, g, bl] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }

  const api = { THEMES, NAMES, resolve, contrast };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.LS_THEMES = api;
})();
