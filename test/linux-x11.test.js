const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWindow, available } = require('../focus/linux-x11');

// Real xprop output from the LXC test machine (XFCE, Mousepad)
const MOUSEPAD = [
  '_NET_WM_PID(CARDINAL) = 4211',
  'WM_CLASS(STRING) = "mousepad", "Mousepad"',
  '_NET_WM_NAME(UTF8_STRING) = "*Untitled 1 - Mousepad"',
  'WM_NAME(STRING) = "*Untitled 1 - Mousepad"',
].join('\n');

test('xprop output gives the process, the class and the title', () => {
  assert.deepEqual(parseWindow(MOUSEPAD), { pid: 4211, name: 'Mousepad', title: '*Untitled 1 - Mousepad' });
});

test('titles with quotes and commas survive', () => {
  const out = 'WM_CLASS(STRING) = "code", "Code"\n_NET_WM_NAME(UTF8_STRING) = "say \\"hi\\", world - Code"';
  assert.equal(parseWindow(out).title, 'say \\"hi\\", world - Code');
  assert.equal(parseWindow(out).name, 'Code');
});

test('missing properties (old Xlib programs like xev) give empty values', () => {
  const out = '_NET_WM_PID:  not found.\nWM_CLASS:  not found.\n_NET_WM_NAME:  not found.\nWM_NAME(STRING) = "libreshard-target"';
  assert.deepEqual(parseWindow(out), { pid: 0, name: '', title: 'libreshard-target' });
  assert.deepEqual(parseWindow(''), { pid: 0, name: '', title: '' });
});

test('the provider only offers itself on Linux with a display', { skip: process.platform === 'linux' }, () => {
  assert.equal(available(), false);
});
