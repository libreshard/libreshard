// Types one combo the way the server does (one key at a time, modifiers first). Run in its own
// process by injection.js: an unmapped key makes Xlib abort the whole process.
const { keyboard } = require('@nut-tree-fork/nut-js');
const { parse } = require('../../keys');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
keyboard.config.autoDelayMs = 0;

(async () => {
  const keys = parse(process.argv[2]);
  for (const k of keys) { await keyboard.pressKey(k); await sleep(15); }
  await sleep(60);
  for (const k of [...keys].reverse()) { await keyboard.releaseKey(k); await sleep(15); }
})().catch((e) => { console.error(e.message); process.exit(1); });
