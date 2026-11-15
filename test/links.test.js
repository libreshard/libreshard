// libreshard:// links (links.js): only "install" with an url is understood; the download and the
// review happen elsewhere, after asking.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLink, linkInArgs } = require('../links');

test('install links give the address to download, and nothing else is understood', () => {
  const file = 'https://github.com/a/b/releases/download/v1/x.libreshard';
  const enc = encodeURIComponent(file);
  assert.deepEqual(parseLink(`libreshard://install?url=${enc}`), { action: 'install', url: file });
  assert.deepEqual(parseLink(`libreshard://install/?url=${enc}`), { action: 'install', url: file });
  assert.deepEqual(parseLink(`LIBRESHARD://INSTALL?url=${enc}`), { action: 'install', url: file });
  assert.deepEqual(parseLink(`libreshard:install?url=${enc}`), { action: 'install', url: file });
  for (const bad of [
    'libreshard://install', 'libreshard://install?url=', `libreshard://uninstall?url=${enc}`, `libreshard://run?cmd=calc`,
    `https://install?url=${enc}`, 'not a link', '', null, 42, `libreshard://install?url=${'a'.repeat(5000)}`,
  ]) assert.equal(parseLink(bad), null, String(bad).slice(0, 40));
});

test('the link is found among the command-line arguments Windows and Linux pass', () => {
  assert.equal(linkInArgs(['C:\LibreShard.exe', '--hidden', 'libreshard://install?url=x']), 'libreshard://install?url=x');
  assert.equal(linkInArgs(['/opt/LibreShard/libreshard', 'C:\a.libreshard']), undefined);
  assert.equal(linkInArgs(undefined), undefined);
});
