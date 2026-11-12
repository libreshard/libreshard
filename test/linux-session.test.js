const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { watchSessionEnd, managersFor, MANAGERS } = require('../linux-session');

// A fake spawn that records each gdbus process and lets the test write its output
function fakeSpawn() {
  const children = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.cmd = cmd;
    child.args = args;
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    children.push(child);
    return child;
  };
  return { spawn, children };
}
const flush = () => new Promise((r) => setImmediate(r));

// Real lines printed by `gdbus monitor` during a logout (Ubuntu 24.04, 2026-11-12)
const GNOME_QUERY = '/org/gnome/SessionManager/Client19: org.gnome.SessionManager.ClientPrivate.QueryEndSession (uint32 0,)';
const GNOME_END = '/org/gnome/SessionManager/Client19: org.gnome.SessionManager.ClientPrivate.EndSession (uint32 0,)';
const XFCE_SHUTDOWN = '/org/xfce/SessionManager: org.xfce.Session.Manager.StateChanged (uint32 1, uint32 3)';
const XFCE_PHASE2 = '/org/xfce/SessionManager: org.xfce.Session.Manager.StateChanged (uint32 3, uint32 4)';
const XFCE_CLIENT = '/org/xfce/SessionClients/2e3: org.xfce.Session.Client.StateChanged (uint32 0, uint32 3)';

test('the session manager is picked from the desktop name', () => {
  assert.deepEqual(managersFor('ubuntu:GNOME').map((m) => m.name), ['org.gnome.SessionManager']);
  assert.deepEqual(managersFor('XFCE').map((m) => m.name), ['org.xfce.SessionManager']);
  assert.deepEqual(managersFor('KDE'), []);
  assert.deepEqual(managersFor(undefined), []);
});

test('GNOME: only EndSession ends it, not the cancellable QueryEndSession', () => {
  const gnome = MANAGERS.find((m) => m.name === 'org.gnome.SessionManager');
  assert.equal(gnome.ending(GNOME_QUERY), false);
  assert.equal(gnome.ending(GNOME_END), true);
});

test('XFCE: the manager entering shutdown ends it, a client changing state does not', () => {
  const xfce = MANAGERS.find((m) => m.name === 'org.xfce.SessionManager');
  assert.equal(xfce.ending(XFCE_SHUTDOWN), true);
  assert.equal(xfce.ending(XFCE_PHASE2), true);
  assert.equal(xfce.ending(XFCE_CLIENT), false);
  assert.equal(xfce.ending('/org/xfce/SessionManager: org.xfce.Session.Manager.StateChanged (uint32 3, uint32 1)'), false, 'back to idle');
});

test('the watcher runs gdbus monitor and calls onEnd once, even when lines arrive in pieces', async () => {
  const { spawn, children } = fakeSpawn();
  const ends = [];
  const stop = watchSessionEnd({ desktop: 'ubuntu:GNOME', spawn, onEnd: (m) => ends.push(m) });
  assert.equal(children.length, 1);
  assert.equal(children[0].cmd, 'gdbus');
  assert.deepEqual(children[0].args, ['monitor', '--session', '--dest', 'org.gnome.SessionManager']);

  children[0].stdout.write(GNOME_QUERY + '\n' + GNOME_END.slice(0, 40));
  await flush();
  assert.deepEqual(ends, [], 'half a line is not enough');
  children[0].stdout.write(GNOME_END.slice(40) + '\n' + GNOME_END + '\n');
  await flush();
  assert.deepEqual(ends, ['org.gnome.SessionManager']);

  stop();
  assert.equal(children[0].killed, true);
});

test('without gdbus, or on another desktop, nothing happens and nothing throws', async () => {
  const lines = [];
  const log = { info() {}, warn: (event) => lines.push(event) };
  const { spawn, children } = fakeSpawn();
  watchSessionEnd({ desktop: 'XFCE', spawn, log, onEnd: () => assert.fail('no end') });
  children[0].emit('error', Object.assign(new Error('spawn gdbus ENOENT'), { code: 'ENOENT' }));
  assert.deepEqual(lines, ['session-watch-failed']);

  const none = fakeSpawn();
  const stop = watchSessionEnd({ desktop: 'KDE', spawn: none.spawn, onEnd: () => assert.fail('no end') });
  assert.equal(none.children.length, 0);
  assert.doesNotThrow(stop);
  assert.doesNotThrow(() => watchSessionEnd({ desktop: 'GNOME', spawn: () => { throw new Error('boom'); }, log, onEnd() {} }));
});
