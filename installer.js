// Prepares a shard for installation from a folder or a .zip/.libreshard file: extracts it safely,
// validates the manifest and gathers what the review screen shows. Nothing is installed here;
// ShardStore.install() does that once the user confirms.
const fs = require('fs');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');
const { validateManifest, classifyKeys } = require('./manifest');

const LIMITS = { maxBytes: 50 * 1024 * 1024, maxFiles: 2000 };

// Extracts a zip into a new temporary folder. Refuses entries that would land outside it (absolute
// paths, "..", drive letters), skips symlinks, and stops at the size and file count limits, using
// the real decompressed size rather than what the zip claims. A failed extraction leaves nothing.
function extractZip(file, limits = LIMITS) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-install-'));
  return new Promise((resolve, reject) => {
    const fail = (e) => {
      // Retries: on macOS a just-closed file can still be on its way out when the folder goes
      fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      reject(e);
    };
    yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return fail(new Error('Not a valid zip file: ' + err.message));
      let files = 0;
      let bytes = 0;
      const open = new Set(); // write streams not closed yet
      let stopped = false;
      // The folder is removed only once every file being written is closed: a write stream opens its
      // file asynchronously, and removing the folder before that finished let the file appear again
      // inside it (ENOTEMPTY on macOS, and a leftover in the temp folder)
      const stop = (e) => {
        if (stopped) return;
        stopped = true;
        zip.close();
        const closing = [...open].map((out) => new Promise((r) => { out.once('close', r); out.destroy(); }));
        Promise.all(closing).then(() => fail(e));
      };
      zip.on('error', stop);
      zip.on('end', () => resolve(dest));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (/^[a-z]:/i.test(name) || name.startsWith('/') || name.split('/').includes('..')) {
          return stop(new Error(`Unsafe path in zip: ${name}`));
        }
        const target = path.join(dest, name);
        if (!target.startsWith(dest + path.sep)) return stop(new Error(`Unsafe path in zip: ${name}`));
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return zip.readEntry(); // symlink: skipped
        if (name.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true });
          return zip.readEntry();
        }
        if (++files > limits.maxFiles) return stop(new Error(`The zip has more than ${limits.maxFiles} files`));
        zip.openReadStream(entry, (e, stream) => {
          if (e) return stop(e);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const out = fs.createWriteStream(target);
          open.add(out);
          out.on('close', () => open.delete(out));
          stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > limits.maxBytes) {
              stream.destroy();
              stop(new Error(`The zip is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB once extracted`));
            }
          });
          stream.on('error', stop);
          out.on('error', stop);
          out.on('finish', () => zip.readEntry());
          stream.pipe(out);
        });
      });
      zip.readEntry();
    });
  });
}

// The manifest may be at the root or inside a single top-level folder (zips are often made that way)
function findShardRoot(dir) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const items = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !d.name.startsWith('.') && d.name !== '__MACOSX');
  if (items.length === 1 && items[0].isDirectory() && fs.existsSync(path.join(dir, items[0].name, 'manifest.json'))) {
    return path.join(dir, items[0].name);
  }
  return null;
}

// Counts plain files and bytes, ignoring links
function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) {
      const m = measure(p);
      files += m.files;
      bytes += m.bytes;
    } else if (d.isFile()) {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
  return { files, bytes };
}

// Everything the review screen needs. `existing` is the installed entry with the same id, if any,
// or a function that finds it from the id.
// Returns { ok: false, errors } when the shard can't be installed.
function describe(sourceDir, { appVersion, existing: findExisting, limits = LIMITS } = {}) {
  const root = findShardRoot(sourceDir);
  if (!root) return { ok: false, errors: ['No manifest.json found (at the top or inside a single folder)'] };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); } catch (e) {
    return { ok: false, errors: ['manifest.json is not valid JSON: ' + e.message] };
  }
  const { ok, errors, manifest } = validateManifest(raw, { appVersion });
  if (!ok) return { ok: false, errors };
  if (!fs.existsSync(path.join(root, 'index.html'))) return { ok: false, errors: ['The shard has no index.html'] };
  // `existing` may be the installed entry or a lookup by id (the id is only known now)
  const existing = typeof findExisting === 'function' ? findExisting(manifest.id) : findExisting;
  const size = measure(root);
  if (size.files > limits.maxFiles || size.bytes > limits.maxBytes) {
    return { ok: false, errors: [`The shard is too big (max ${limits.maxFiles} files and ${Math.round(limits.maxBytes / 1024 / 1024)} MB)`] };
  }
  if (existing?.bundled) return { ok: false, errors: [`The id "${manifest.id}" belongs to a shard bundled with LibreShard`] };
  if (existing?.linked) return { ok: false, errors: [`"${manifest.id}" is linked to a development folder; uninstall it first`] };

  const update = existing ? {
    fromVersion: existing.manifest.version || null,
    addedKeys: manifest.keys.filter((k) => !existing.manifest.keys.includes(k)),
    removedKeys: existing.manifest.keys.filter((k) => !manifest.keys.includes(k)),
  } : null;
  return { ok: true, root, manifest, risk: classifyKeys(manifest.keys), size, update };
}

// From a path picked or dropped by the user: a folder, or a .zip / .libreshard file.
// Returns describe()'s result plus `cleanup()` for the temporary folder of a zip.
async function prepare(source, opts = {}) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) return { ...describe(source, opts), cleanup: () => {} };
  if (!/\.(zip|libreshard)$/i.test(source)) return { ok: false, errors: ['Pick a shard folder, or a .zip or .libreshard file'], cleanup: () => {} };
  const dir = await extractZip(source, opts.limits);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const result = describe(dir, opts);
  if (!result.ok) cleanup();
  return { ...result, cleanup };
}

module.exports = { prepare, describe, extractZip, findShardRoot, LIMITS };
