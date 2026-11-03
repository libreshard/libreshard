// Under X11: opens a window that logs keyboard events (xev), focuses it, types combos the way the
// server does and checks what arrived for each. Also reports what foreground app detection sees.
// Run by test/linux/run.sh inside the container.
const { spawn, spawnSync, execFileSync } = require('child_process');
const path = require('path');
const focus = require('../../focus');
const { createFocus } = require('../../focus');
const { unavailable } = require('../../keys');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Combo → keyboard events expected in xev ("+" press, "-" release)
const CASES = [
  ['ctrl+shift+m', '+Control_L +Shift_L +M -M -Shift_L -Control_L'],
  ['rctrl+f9', '+Control_R +F9 -F9 -Control_R'],
  ['ralt+k', '+Alt_R +k -k -Alt_R'],
  ['numpad7', '+KP_Home -KP_Home|+KP_7 -KP_7'],
  ['f13', '+F13 -F13'],
  ['f24', '+F24 -F24'],
  ['playpause', '+XF86AudioPlay -XF86AudioPlay'],
];

function eventsIn(text) {
  const out = [];
  const re = /(KeyPress|KeyRelease) event[\s\S]*?keysym 0x[0-9a-f]+, (\w+)\)/g;
  for (const m of text.matchAll(re)) out.push(`${m[1] === 'KeyPress' ? '+' : '-'}${m[2]}`);
  // Shift+m may report the release as "m"
  return out.join(' ').replace(/-m(?= -Shift_L)/, '-M');
}

(async () => {
  const xev = spawn('xev', ['-name', 'libreshard-target', '-event', 'keyboard']);
  let log = '';
  xev.stdout.on('data', (d) => { log += d; });
  await sleep(1500);

  const wid = execFileSync('xdotool', ['search', '--name', 'libreshard-target']).toString().trim().split('\n')[0];
  // xev is an old Xlib program that declares neither its process nor its class; real apps (GTK, Qt,
  // Electron) declare both, and active-win needs them, so set them like a real app would.
  execFileSync('xprop', ['-id', wid, '-f', '_NET_WM_PID', '32c', '-set', '_NET_WM_PID', String(xev.pid)]);
  execFileSync('xdotool', ['set_window', '--classname', 'xev', '--class', 'Xev', wid]);
  execFileSync('xdotool', ['windowactivate', '--sync', wid]);
  await sleep(300);

  const active = await focus.active();
  const check = await focus.check([{ exe: 'xev' }]);
  console.log(`detection provider: ${focus.providerName()}`);
  console.log(`foreground app: ${JSON.stringify(active)}`);
  console.log(`detection by executable: ${check.ok ? 'OK' : 'FAILED ' + JSON.stringify(check)}`);

  // The xprop provider must give the same answer, for systems where active-win didn't install
  const x11 = createFocus({ providers: [require('../../focus/linux-x11')], cacheMs: 0 });
  const x11Active = await x11.active();
  const x11Check = await x11.check([{ exe: 'xev' }]);
  console.log(`linux-x11 provider: ${JSON.stringify(x11Active)}`);
  console.log(`linux-x11 detection by executable: ${x11Check.ok ? 'OK' : 'FAILED ' + JSON.stringify(x11Check)}`);
  const x11Open = await x11.openApps();
  console.log(`linux-x11 open apps: ${x11Open.map((a) => a.exe).join(', ')}`);

  let failures = (check.ok ? 0 : 1) + (x11Check.ok ? 0 : 1);
  for (const [combo, expected] of CASES) {
    // What the server does first: keys missing from the keymap are refused, never pressed
    const missing = unavailable(combo);
    if (missing.length) {
      console.log(`OK   ${combo.padEnd(14)} refused: ${missing.join('+')} is not in this keymap (pressing it would abort the process)`);
      continue;
    }
    const before = log.length;
    const r = spawnSync(process.execPath, [path.join(__dirname, 'type-one.js'), combo], { encoding: 'utf8' });
    await sleep(300);
    const got = eventsIn(log.slice(before));
    const ok = r.status === 0 && expected.split('|').includes(got);
    if (!ok) failures++;
    const err = r.status !== 0 ? ` (exit ${r.status}: ${(r.stderr || '').split('\n').find((l) => l.trim()) || ''})` : '';
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${combo.padEnd(14)} ${got || '(no events)'}${ok ? '' : `   expected ${expected}${err}`}`);
  }
  xev.kill();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
