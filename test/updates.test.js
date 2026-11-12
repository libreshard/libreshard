const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, checkLatest, LATEST_URL } = require('../updates');

test('versions are parsed with or without "v", and anything else is refused', () => {
  assert.deepEqual(parseVersion('v0.3.0'), { nums: [0, 3, 0], pre: '' });
  assert.deepEqual(parseVersion('1.2.10-beta.2'), { nums: [1, 2, 10], pre: 'beta.2' });
  assert.deepEqual(parseVersion('1.0.0+build.5'), { nums: [1, 0, 0], pre: '' });
  for (const bad of ['', '1.2', 'latest', '1.2.3.4', null, undefined, '<script>']) assert.equal(parseVersion(bad), null, String(bad));
});

test('versions compare as Semantic Versioning says', () => {
  const ordered = ['0.2.0', '0.2.1', '0.3.0-alpha', '0.3.0-alpha.1', '0.3.0-alpha.beta', '0.3.0-beta', '0.3.0-beta.2', '0.3.0-beta.11', '0.3.0-rc.1', '0.3.0', '0.10.0', '1.0.0'];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(compareVersions(ordered[i + 1], ordered[i]) > 0, `${ordered[i + 1]} > ${ordered[i]}`);
    assert.ok(compareVersions(ordered[i], ordered[i + 1]) < 0, `${ordered[i]} < ${ordered[i + 1]}`);
  }
  assert.equal(compareVersions('v0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('junk', '0.3.0'), 0, 'unparseable never counts as newer');
});

// A fake fetch that answers like GitHub and remembers what it was asked
function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('the latest release is read from GitHub and compared with this version', async () => {
  const fetch = fakeFetch(200, { tag_name: 'v0.4.0', prerelease: false });
  assert.deepEqual(await checkLatest({ current: '0.3.0', fetch }), { latest: '0.4.0', newer: true });
  assert.equal(fetch.calls[0].url, LATEST_URL);
  assert.ok(LATEST_URL.endsWith('/releases/latest'), 'never drafts or pre-releases');
  // Nothing about the user: only a generic User-Agent and the Accept header
  assert.deepEqual(Object.keys(fetch.calls[0].opts.headers).sort(), ['Accept', 'User-Agent']);
  assert.equal(fetch.calls[0].opts.headers['User-Agent'], 'LibreShard');

  assert.deepEqual(await checkLatest({ current: '0.4.0', fetch }), { latest: '0.4.0', newer: false });
  assert.deepEqual(await checkLatest({ current: '0.5.0-beta.1', fetch }), { latest: '0.4.0', newer: false });
});

test('errors and odd answers reject instead of announcing anything', async () => {
  await assert.rejects(checkLatest({ current: '0.3.0', fetch: fakeFetch(404, {}) }), /404/);
  await assert.rejects(checkLatest({ current: '0.3.0', fetch: fakeFetch(200, { tag_name: 'nightly' }) }), /No version/);
  await assert.rejects(checkLatest({ current: '0.3.0', fetch: async () => { throw new Error('offline'); } }), /offline/);
});
