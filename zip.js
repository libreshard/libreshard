// Writing zips: backups and exported shards. A plain zip (deflate, UTF-8 names), no dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// [{ name, data: Buffer }] → the zip as a Buffer
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by Unix, so the mode below counts
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// Every plain file under root, as paths relative to it with "/". Links are skipped (like
// install()), and with { hidden: false } so is anything whose name starts with a dot (.git,
// .DS_Store), which the server never serves anyway.
function filesUnder(root, { hidden = true } = {}, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (!hidden && d.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) out.push(...filesUnder(root, { hidden }, r));
    else if (d.isFile()) out.push(r);
  }
  return out;
}

// A shard folder as a .libreshard: its files at the root of the zip, without hidden files or links
function shardZip(root) {
  return createZip(filesUnder(root, { hidden: false }).map((rel) => ({ name: rel, data: fs.readFileSync(path.join(root, rel)) })));
}

module.exports = { createZip, filesUnder, shardZip };
