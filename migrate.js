// The data folder follows the app's name, which changed twice (ShardPad → LibrePad → LibreShard).
// On the first start with an empty data folder, the newest old folder that has a config is copied
// over: settings, paired devices, approvals, app rules and the user's shards.

const fs = require('fs');
const path = require('path');

const OLD_NAMES = ['LibrePad', 'librepad', 'ShardPad', 'shardpad'];
const FILES = ['config.json', 'devices.json', 'shards-state.json', 'app-rules.json'];

// Copies a shards folder entry by entry. Development shards are links (junctions on Windows) to a
// folder elsewhere: they're recreated as links to the same real folder, never copied.
function copyShards(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dest = path.join(to, e.name);
    if (fs.existsSync(dest)) continue;
    if (e.isSymbolicLink()) {
      let target;
      try { target = fs.realpathSync(src); } catch { continue; } // broken link: nothing to bring
      fs.symlinkSync(target, dest, 'junction');
    } else if (e.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
    }
  }
}

// Returns the folder it migrated from, or null.
function migrateData(appData, userData, names = OLD_NAMES) {
  if (fs.existsSync(path.join(userData, 'config.json'))) return null;
  const old = names
    .map((n) => path.join(appData, n))
    .find((d) => path.resolve(d) !== path.resolve(userData) && fs.existsSync(path.join(d, 'config.json')));
  if (!old) return null;
  fs.mkdirSync(userData, { recursive: true });
  for (const f of FILES) {
    const src = path.join(old, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(userData, f));
  }
  if (fs.existsSync(path.join(old, 'shards'))) copyShards(path.join(old, 'shards'), path.join(userData, 'shards'));
  return old;
}

module.exports = { migrateData, OLD_NAMES };
