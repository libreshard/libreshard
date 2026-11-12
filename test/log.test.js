const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLog, once, shortId, formatLine, homeRedactor } = require('../log');
const { Devices } = require('../pairing');
const { ShardStore } = require('../shard-store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-log-'));
const at = new Date('2026-11-11T18:00:00.000Z');

test('a line has the time, the level, the event and key=value details', () => {
  assert.equal(formatLine('warn', 'pair-failed', { alert: false, n: 3 }, at), '2026-11-11T18:00:00.000Z WARN  pair-failed alert=false n=3\n');
  assert.equal(formatLine('info', 'start', {}, at), '2026-11-11T18:00:00.000Z INFO  start\n');
});

test('values with spaces, quotes or "=" are quoted, undefined is left out, unquoted paths stay as they are', () => {
  const line = formatLine('info', 'e', { a: 'two words', b: 'say "hi"', c: 'k=v', d: undefined, e: '', f: 'C:\\x\\y' }, at);
  assert.equal(line, '2026-11-11T18:00:00.000Z INFO  e a="two words" b="say \\"hi\\"" c="k=v" e="" f=C:\\x\\y\n');
});

test('backslashes inside quotes are escaped, so a trailing one cannot end the value', () => {
  assert.equal(formatLine('info', 'e', { p: 'C:\\Program Files\\', n: 'x' }, at),
    '2026-11-11T18:00:00.000Z INFO  e p="C:\\\\Program Files\\\\" n=x\n');
  assert.equal(formatLine('info', 'e', { q: 'a\\" b' }, at), '2026-11-11T18:00:00.000Z INFO  e q="a\\\\\\" b"\n');
});

test('an Error detail gives its message and its stack on the following lines', () => {
  const err = new Error('disk full');
  const [first, ...rest] = formatLine('error', 'save-failed', { error: err }, at).trimEnd().split('\n');
  assert.equal(first, '2026-11-11T18:00:00.000Z ERROR save-failed error="disk full"');
  assert.ok(rest.length > 0 && rest.every((l) => l.startsWith('    at ')));
});

test('a line break in a value never starts a new log line', () => {
  const line = formatLine('warn', 'e', { error: 'one\ntwo' }, at);
  assert.equal(line.split('\n').length, 2);
});

test('long values are cut', () => {
  const line = formatLine('info', 'e', { v: 'x'.repeat(2000) }, at);
  assert.ok(line.length < 600);
  assert.ok(line.includes('…'));
});

test('the home folder becomes "~" in values and stacks', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\Someone' : '/home/someone';
  const redact = homeRedactor(home);
  const err = new Error(`cannot open ${home}${path.sep}file`);
  err.stack = `Error: x\n    at f (${home}${path.sep}app${path.sep}main.js:1:1)`;
  const line = formatLine('error', 'e', { error: err, where: home }, at, redact);
  assert.ok(!line.includes(home), line);
  // The message is quoted (it has spaces), so a Windows separator comes out escaped; stacks never are
  const quotedSep = path.sep === '\\' ? '\\\\' : '/';
  assert.ok(line.includes(`cannot open ~${quotedSep}file`) && line.includes(`(~${path.sep}app`), line);
  if (process.platform === 'win32') assert.equal(redact('c:\\users\\someone\\x'), '~\\x', 'case-insensitive on Windows');
});

test('the log appends to its file and creates its folder', () => {
  const dir = tmp();
  const file = path.join(dir, 'logs', 'libreshard.log');
  const log = createLog({ file, clock: () => at });
  log.info('start', { version: '0.3.0' });
  log.warn('w');
  log.error('e', { error: 'boom' });
  assert.deepEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean), [
    '2026-11-11T18:00:00.000Z INFO  start version=0.3.0',
    '2026-11-11T18:00:00.000Z WARN  w',
    '2026-11-11T18:00:00.000Z ERROR e error=boom',
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the file rotates by size and keeps only the newest files', () => {
  const dir = tmp();
  const file = path.join(dir, 'libreshard.log');
  const log = createLog({ file, maxBytes: 200, keep: 2, clock: () => at });
  for (let i = 0; i < 20; i++) log.info('event', { n: i });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['libreshard.log', 'libreshard.log.1', 'libreshard.log.2']);
  for (const f of fs.readdirSync(dir)) assert.ok(fs.statSync(path.join(dir, f)).size <= 200);
  // The newest event is in the current file, and the oldest ones are gone
  assert.ok(fs.readFileSync(file, 'utf8').includes('n=19'));
  const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(!all.includes('n=0\n'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an existing file keeps growing until it reaches the limit', () => {
  const dir = tmp();
  const file = path.join(dir, 'libreshard.log');
  fs.writeFileSync(file, 'x'.repeat(190) + '\n');
  createLog({ file, maxBytes: 200, clock: () => at }).info('event');
  assert.ok(fs.existsSync(file + '.1'), 'rotated on the first write past the limit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tail gives the last lines, reaching into the previous file when the current one is short', () => {
  const dir = tmp();
  const file = path.join(dir, 'libreshard.log');
  const log = createLog({ file, maxBytes: 200, clock: () => at });
  for (let i = 0; i < 10; i++) log.info('event', { n: i });
  const last = log.tail(4);
  assert.equal(last.length, 4);
  assert.ok(last[3].endsWith('n=9'));
  assert.ok(log.tail(1000).length > fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a log that cannot be written never throws', (t) => {
  const dir = tmp();
  const errors = t.mock.method(console, 'error', () => {});
  // The "file" is a folder: every append fails
  const log = createLog({ file: dir });
  assert.doesNotThrow(() => { log.info('a'); log.error('b'); });
  assert.equal(errors.mock.callCount(), 1, 'reported once, not on every line');
  assert.deepEqual(createLog({ file: path.join(dir, 'missing', 'x.log') }).tail(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('once() logs each distinct error a single time', () => {
  const lines = [];
  const fake = { warn: (e, d) => lines.push([e, d.error]) };
  const warnOnce = once(fake);
  warnOnce('focus-failed', { error: new Error('a') });
  warnOnce('focus-failed', { error: new Error('a') });
  warnOnce('focus-failed', { error: new Error('b') });
  warnOnce('other', { error: new Error('a') });
  assert.deepEqual(lines.map(([e, err]) => `${e}:${err.message}`), ['focus-failed:a', 'focus-failed:b', 'other:a']);
});

test('shortId keeps enough of a device id to tell devices apart', () => {
  assert.equal(shortId('0123456789abcdef'), '012345');
  assert.equal(shortId(undefined), undefined);
});

// A logger that keeps lines in memory
function memoryLog() {
  const lines = [];
  const add = (level) => (event, details = {}) => lines.push({ level, event, details });
  return { lines, info: add('info'), warn: add('warn'), error: add('error') };
}

test('a damaged devices.json is reported; a missing one is not', () => {
  const dir = tmp();
  const log = memoryLog();
  new Devices(path.join(dir, 'devices.json'), { log });
  assert.equal(log.lines.length, 0);
  fs.writeFileSync(path.join(dir, 'devices.json'), '{ nope');
  assert.equal(new Devices(path.join(dir, 'devices.json'), { log }).all().length, 0);
  assert.deepEqual(log.lines.map((l) => l.event), ['devices-invalid']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rejected shard folder is logged once, and again only if its errors change', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.writeFileSync(path.join(dir, 'broken', 'manifest.json'), '{ nope');
  const log = memoryLog();
  const store = new ShardStore({ dirs: [{ dir, bundled: false }], log });
  store.load();
  assert.deepEqual(log.lines.map((l) => [l.event, l.details.folder]), [['shard-rejected', 'broken']]);
  fs.writeFileSync(path.join(dir, 'broken', 'manifest.json'), JSON.stringify({ id: 'Bad Id!' }));
  store.load();
  assert.equal(log.lines.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
