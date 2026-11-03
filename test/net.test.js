const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { hostAllowed, hostname, isPrivateAddress } = require('../net');

test('hostname strips the port, including IPv6 brackets', () => {
  assert.equal(hostname('192.168.0.10:7878'), '192.168.0.10');
  assert.equal(hostname('LocalHost:7878'), 'localhost');
  assert.equal(hostname('[fe80::1]:7878'), '[fe80::1]');
  assert.equal(hostname(undefined), '');
});

test('only local names and the PC\'s own addresses are allowed hosts', () => {
  assert.ok(hostAllowed('localhost:7878'));
  assert.ok(hostAllowed('127.0.0.1:7878'));
  assert.ok(hostAllowed('libreshard.local:7878'));
  assert.ok(!hostAllowed('evil.example'));
  assert.ok(!hostAllowed('evil.example:7878'));
  assert.ok(!hostAllowed('127.0.0.1.evil.example'));
  assert.ok(!hostAllowed(''));
  assert.ok(!hostAllowed(undefined));

  const own = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
  if (own) assert.ok(hostAllowed(`${own.address}:7878`), 'the LAN address works');
});

test('private, loopback, link-local and Tailscale addresses are accepted', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.50',
    '169.254.10.10', '100.64.0.1', '100.127.255.254', '::1', '::ffff:192.168.1.5', 'fd12:3456::1', 'fe80::1%12']) {
    assert.ok(isPrivateAddress(a), a);
  }
});

test('public addresses are refused', () => {
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.255.255', '100.128.0.1', '192.169.0.1',
    '::ffff:8.8.8.8', '2001:4860:4860::8888', '', 'garbage', undefined]) {
    assert.ok(!isPrivateAddress(a), String(a));
  }
});
