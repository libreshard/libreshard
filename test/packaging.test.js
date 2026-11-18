const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { files } = require('../package.json').build;

// Whether electron-builder's "files" list takes a path: a file named as it is, or a folder/**
const packaged = (rel) => files.some((f) => (f.endsWith('/**') ? rel.startsWith(f.slice(0, -2)) : rel === f));

// Every local file a script loads with require('./…') or require('../…'), and what those load
function localRequires(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    let target = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.js');
    else if (!fs.existsSync(target)) target += '.js';
    if (fs.existsSync(target) && target.endsWith('.js')) localRequires(target, seen);
  }
  return seen;
}

test('every local module the app loads is in the installers ("build.files" in package.json)', () => {
  const missing = [...localRequires(path.join(root, 'main.js'))]
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((rel) => !packaged(rel));
  // A missing file only shows in the packaged app, which then fails to start
  assert.deepEqual(missing, []);
});
