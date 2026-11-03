# LibreShard: project context

> Keep this file at the project root. It is context for Claude Code, Cursor or other assistants, and documentation for developers. If your tool expects another name, rename it (`CONTEXT.md`, `AGENTS.md`).

## 1. What it is

LibreShard is a desktop app (Electron) that turns a tablet into an extra control panel for the PC. The tablet only shows a web page. The PC is what presses the keys.

What sets it apart: the panel's content is made of **shards**, folders with HTML, CSS and JS that anyone can write and share. Nothing needs to be compiled, and the app's code doesn't need to be touched.

On the tablet, the user pairs the device once (scanning a QR or typing a short code), sees a **menu with every shard**, opens one full screen, and can switch shards or go back to the menu with a **floating button** in the top-left corner.

Each shard can be limited to certain applications. For example, a Photoshop shard only acts while Photoshop (or a similar app the user picks) is in the foreground. If a button is tapped with another app active, the PC does nothing and the tablet shows a notice.

Project language: code, comments and this file are in English. All UI text (PC window and tablet viewer) lives in `i18n/es.json` and `i18n/en.json`, following the system language (the tablet's, for the viewer) with English as the fallback, unless a language is chosen in the PC's settings. `README.md` is in English with `README.es.md` alongside. The maintainer's work plans in `docs/plans/` are in Spanish and stay out of the repository (`.gitignore`).

Identity: the project used to be called ShardPad, then LibrePad (renamed to LibreShard on 2026-11-02, before the first release, because other software already used that name). The logo is a cyan "L" with a double outline and a gold button sending out waves. Tagline: "Open-Source Control Deck". Palette: navy background `#0d1b2a`, cyan `#22d3ee`, gold `#fbbf24`. "Shard" is still the name of the panels.

## 2. Architecture

```
Tablet (browser)                           PC (Electron app)
┌──────────────────────┐   HTTP (shards)   ┌─────────────────────────────┐
│ viewer/index.html    │◀─────────────────▶│ server.js (Express)         │
│  ├ shard menu        │                   │  ├ serves /viewer           │
│  ├ iframe of the     │   WebSocket /ws   │  ├ serves /shards/:id/*     │
│  │  open shard       │──────────────────▶│  └ WebSocket: auth + keys   │
│  ├ floating button   │                   │        │ checks permissions │
│  └ postMessage bridge│                   │        ▼                    │
└──────────────────────┘                   │ keys.js → nut-js → keyboard │
                                           └─────────────────────────────┘
```

Key points:

- **The tablet runs nothing.** It only renders HTML and forwards taps.
- **Shards never talk to the PC.** They live in an isolated iframe and can only send a `postMessage` to the viewer.
- **The viewer forwards over WebSocket** to the agent, saying which shard the action comes from.
- **The agent validates everything.** Even if the viewer or the shard is compromised, the PC only types keys declared in that shard's manifest.
- **The agent checks the foreground app** when the shard is limited to certain apps. If it doesn't match, it blocks the action and tells the tablet.
- **The menu and the floating button belong to the viewer**, not the shard. No shard can remove, cover or change them.

## 3. Project structure

```
libreshard/
├── package.json          dependencies, scripts and electron-builder config
├── main.js               Electron main process (config, desktop window, IPC, installs, quitting safely)
├── server.js             HTTP + WebSocket server, key validation and typing
├── shard-store.js        shard registry: loading, approvals, enable/disable, install/uninstall, hot reload
├── installer.js          prepares a shard from a folder or a .zip/.libreshard for the review screen
├── shard-settings.js     per-shard settings: schema validation, saved values, labels per language
├── pairing.js            pairing codes, paired devices (token hashes) and the attempt limiter
├── migrate.js            copies the data folder over from the old names (LibrePad, ShardPad) on first run
├── manifest.js           shard manifest validation and key risk classification
├── net.js                allowed Host headers and private-network checks
├── keys.js               turns "ctrl+shift+m" into nut-js keys
├── focus/                foreground app detection
│   ├── index.js          createFocus(): picks a provider; check(), active(), openApps()
│   ├── apps.js           app entries ({ exe } / { match }), normalizeApp, appMatches, appLabel
│   ├── active-win.js     provider: program and executable via active-win@8 (Windows, macOS, Linux if installed)
│   ├── linux-x11.js      provider: Linux/X11 through xprop, when active-win didn't install
│   └── title.js          fallback provider: window title via nut-js
├── desktop/              the PC window: index.html, app.js, style.css and preload.js (the only bridge)
├── i18n/                 UI strings: index.js (pickLocale, strings, translator), es.json, en.json
├── brand/
│   ├── render-icons.js   generates the PNGs and logo-full.svg from the mark (npm run icons)
│   └── logo-full.svg     mark + name, for the README (generated)
├── build/
│   ├── icon.png          app icon for electron-builder (generated)
│   ├── linux/            .deb post-install/post-remove scripts (AppArmor profile)
│   └── windows/installer.nsh  NSIS additions: optional firewall rule, file type cleanup on uninstall
├── .github/workflows/    ci.yml (tests on 3 OSes, Linux injection, DCO) and release.yml (tag v* → draft release)
├── LICENSE, NOTICE       Apache-2.0; LICENSES/MIT-0.txt for shard-base/ and docs/shard-template/
├── README*.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, TRADEMARKS.md   public docs
├── viewer/
│   ├── index.html        tablet viewer markup and styles (pairing, menu, full-screen shard, floating button)
│   ├── app.js            the viewer's script (kept out of the HTML so the CSP can forbid inline scripts)
│   ├── shard-api.js      script the server injects into every shard
│   ├── manifest.webmanifest  name and icons when the viewer is added to the home screen
│   └── brand/            logo-mark.svg (single source of the mark) and generated PNG icons
├── shards/               shards bundled with the app (see "Bundled shards" in section 5)
│   ├── desarrollo/  discord-basico/  edicion-imagen/  escritorio/
│   └── multimedia/  obs/  teclado-numerico/  videollamadas/
├── shard-base/           shared look of the bundled shards: base.css, icons.js (own icon set), libreshard.js
├── tools/
│   └── build-shard-base.js   copies libreshard.css/libreshard.js into every bundled shard (npm run shards:base)
├── docs/shards.md        the guide for shard authors (public; keep it in step with section 5)
├── docs/shard-template/  minimal shard for authors (manifest, index.html, README, base copies)
├── docs/images/          README screenshots
├── test/                 node:test suite (npm test)
│   └── linux/            Docker check under Xvfb: suite + real key injection and detection (npm run test:linux)
└── docs/plans/           local work plans in Spanish (not in the repository)
```

Dependencies in `package.json`: `express`, `ws`, `qrcode`, `yauzl` (reads shard zips), `@nut-tree-fork/nut-js` (production) and `electron` (45), `electron-builder` (26) (development). Optional: `active-win@8` (recognizes the program and its executable; installed by default, see section 8). Every version is exact (`.npmrc` has `save-exact=true`).

Licensing: the project is Apache-2.0. `shard-base/` and `docs/shard-template/` (and the `libreshard.css`/`libreshard.js` copies in each shard) are MIT-0, so shard authors can copy them freely; their source files carry `SPDX-License-Identifier: MIT-0`. The name and logo are covered by `TRADEMARKS.md`, not by the license. Contributions are inbound=outbound plus a DCO sign-off (`git commit -s`), checked by CI on pull requests.

### What each file does

**main.js**
- Only one instance runs (`requestSingleInstanceLock`). Opening the app again focuses the existing window and hands over any `.libreshard`/`.zip` it was opened with (`second-instance`; `open-file` on macOS; `process.argv` on the first launch).
- On first run (no `config.json` in `userData`), `migrate.js` copies the data files (`config.json`, `devices.json`, `shards-state.json`, `app-rules.json`) and `shards/` from the newest old data folder (`LibrePad`, then `ShardPad`). Development shards (links) are recreated as links to the same folder; the old folder is left untouched.
- `SETTINGS` defines the settings in `<userData>/config.json`, with defaults and validation: `port` (7878), `allowPublicNetworks` (false), `confirmDevices` (false), `allowAppsFromTablet` (true) and `language` (`auto`). `loadConfig()` fills in missing or invalid values and deletes the old `pin` field.
- Creates the `Devices` store (`devices.json`), the `Pairing` codes and the `ShardStore` (bundled `shards/` first, then `<userData>/shards`, with `shards-state.json`, `app-rules.json` and `watch: true`), and starts the server with them. If the port is taken (`EADDRINUSE`) it shows a dialog and quits.
- `confirmPairing`: when `confirmDevices` is on, a native dialog over the window asks before a new device gets its token.
- `buildState()` gathers everything the desktop window shows (pairing code and QRs, devices, shards with `classifyKeys`, rejected shards, settings, pause, alert, strings for the language) and `push()` sends it on every change (store, devices, pairing, settings).
- **IPC**: `handle(channel, fn)` only accepts calls from the window's own page (`e.sender` and `senderFrame.url` must match `desktop/index.html`), validates every argument and returns `{ ok: false, errors }` instead of throwing. Channels: `state:get`, `app:pause`, `app:open-viewer`, `app:open-path`, `app:restart`, `settings:set`, `device:rename`, `device:remove`, `install:pick`, `install:path`, `install:confirm`, `install:cancel`, `shard:approve`, `shard:enable`, `shard:open`, `shard:uninstall`, `shard:set-apps`, `shard:reset-apps`, `apps:open` (open programs with icons, never LibreShard itself) and `apps:detect` (the program in front; refuses LibreShard itself). Program icons come from `app.getFileIcon()`, cached per path. Removing a device and uninstalling a shard ask for confirmation in a native dialog.
- **Installs**: `prepareInstall()` runs `installer.prepare()` and keeps the result under a random id until the page confirms (`install:confirm` → `store.install()`) or cancels; either way the temporary folder is removed.
- `lanInterfaces()` lists the non-internal IPv4 interfaces. It drops virtual adapters by name (regex `VIRTUAL`: Hyper-V, WSL, VirtualBox, VMware, Docker…) and marks VPNs that match the `VPN` regex (Tailscale, ZeroTier, Hamachi, WireGuard…). VPNs are sorted last. QR images are cached per pairing token.
- The window loads `desktop/index.html` with `contextIsolation`, `sandbox` and `desktop/preload.js`; `will-navigate` and new windows are blocked (the viewer is opened with `shell.openExternal`).
- On `before-quit` it waits for `server.releaseAll()`, so no key a tablet is holding stays pressed after the app closes. `quitting` is set there, so a real quit is never turned into "hide".
- **Tray:** a `Tray` with Open / Pause or Resume / Quit (labels follow the language). With `closeToTray` on (default), closing the window hides it and the server keeps running; the first time, a notification says so. Without a tray (some Linux desktops), closing quits as before. `--hidden` starts with only the tray icon.
- **Open at login** (`openAtLogin`, off by default): `app.setLoginItemSettings` on Windows and macOS (with `--hidden`; in development the entry is named `electron.app.Electron` and points at the project's Electron), and `~/.config/autostart/libreshard.desktop` on Linux (using `$APPIMAGE` when running from an AppImage).
- Extra IPC: `shard:settings`, `shard:reset-settings`, `shard:favorite`, `shard:move`, `install:pick-dev` (folder dialog for development mode), and `install:path` accepts `{ link: true }`. A candidate with `link` is confirmed with `store.link()` instead of `store.install()`.
- `state.settings` carries every setting the Ajustes tab shows, `closeToTray` and `openAtLogin` included (without them their switches always looked off).

**desktop/** (the PC window; plain JS, no dependencies)
- `preload.js` exposes `window.libreshard` (one function per IPC channel, plus `onState`, `onReview` and `pathForFile` through `webUtils` for dropped files). The page has no Node access.
- `app.js` renders four tabs from the state: **Conectar** (QRs, code with countdown, "Open on this PC"), **Dispositivos** (rename, unpair, confirm-new-devices switch), **Shards** (install from zip/folder or by dropping, review, approve, enable/disable, open folder, uninstall, rejected shards with their errors) and **Ajustes** (language, port, confirm devices, public networks, folders). A pause button sits in the header.
- The **apps editor** ("Apps" on each shard card) chooses between "In any app" and "Only in these apps". Apps are added by picking an open program (with its icon), with "Detect app" (a 5 s countdown, then the program in front), or by typing a text rule. "Restore suggestions" removes the user's rule.
- **Shard settings** ("Settings" on cards whose manifest declares them): a form built from the schema (switch, select, number, color, text), labels in the app's language; "Default values" resets them.
- **Menu order and favorites:** the Shards tab lists shards in the tablet's menu order; each card has a star (favorite) and ↑/↓. Tablets refresh their menu at once (`shards-changed`).
- **Load in development…** picks a folder and shows the review with the link wording; linked shards carry the "In development" badge.
- The review dialog shows a shard's keys (system combos in red, new or unapproved ones in gold), its apps, warnings from `classifyKeys` and, for updates, the version and key changes.
- Everything is built with `h()`/`fill()` and `textContent`; nothing from manifests or devices goes through `innerHTML`. The page CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:` (no inline styles either).
- UI text comes from `state.strings` through `t()`.

**shard-store.js**
- `ShardStore({ dirs: [{ dir, bundled }], installDir, stateFile, rulesFile, appVersion, watch })` loads and validates every shard (first id wins), and emits `change` on every reload.
- Each entry has `manifest`, `root`, `realRoot`, `bundled`, `linked` (the folder is a symlink/junction), `enabled`, `allowed` (manifest keys ∩ approved keys), `pendingKeys` and `apps`.
- **Approvals** live in `shards-state.json` (`{ id: { approved: [...], disabled: true } }`). Bundled shards are approved as they are. A user shard (copied by hand or linked) starts with no approved keys; keys added to a manifest later stay blocked until `approve(id)`.
- **Menu order:** `all()` (and so the PC list and the tablet menu) sorts favorites first, then by the saved `position`, then by name. `setFavorite(id, on)` and `move(id, ±1)` (within the favorites group or the rest, never across) save `favorite` / `position` in `shards-state.json`.
- `get(id)` only returns enabled shards; `publicList()` is what the tablet gets (with `pending` when keys await approval, and `favorite`).
- `install(sourceDir, manifest)` copies to `installDir/<id>` (skipping links), approves the reviewed keys and replaces an installed copy. It refuses bundled ids, linked shards and ids installed somewhere else.
- `uninstall(id)` removes a user shard. A linked shard only loses its link (`removeShardFolder` never follows links, and `fs.rmSync` doesn't follow links inside a copied shard either).
- **App rules** (`app-rules.json`): `{ id: { mode: 'any' } | { mode: 'only', apps: [entries] } }`; the old list format (strings, `"*"` = any) is still read. Entries expose `apps` (effective entries), `customApps` (the user has a rule) and `suggestedApps` (the manifest's). `setRule(id, rule)`, `resetRule(id)` and `addApp(id, { exe, name })` write the file through `writeRules()`, which keeps every other rule and refuses to overwrite a file with invalid JSON.
- **Settings:** `entry.settings` holds every declared setting with a valid value (saved in `shards-state.json` under `settings`, else the default). `setSettings(id, values)` checks each value against the manifest and emits `settings` (id, values); `resetSettings(id)` goes back to the defaults.
- **Renamed bundled shards:** `RENAMED` (`photoshop-basico` → `edicion-imagen`). At startup `migrateIds()` moves the old id's entry in `shards-state.json` (favorite, order…) and its rule in `app-rules.json` to the new id, only when nothing is saved under the new id yet; a rules file with invalid JSON is left alone.
- **Development links:** `link(sourceDir, manifest)` puts a folder in the user's shard folder as a junction (Windows) or symlink, and approves the reviewed keys. `watchLinked()` watches each linked shard's real folder: a `manifest.json` change reloads the store (new keys stay pending), any other change emits `files` (id).
- `watch()` reloads (debounced) when the user's shard folder changes, re-applies `app-rules.json` when it changes, and watches linked shards.

**installer.js**
- `prepare(source, { appVersion, existing })`: a folder, or a `.zip`/`.libreshard` extracted with `extractZip()` into a temporary folder. Returns `{ ok, root, manifest, risk, size, update, cleanup }` or `{ ok: false, errors }`.
- `extractZip()` refuses entries with absolute paths, drive letters or `..`, skips symlinks, and stops at 50 MB of real decompressed data or 2000 files. A failed extraction removes its folder.
- The manifest may be at the root or inside a single top-level folder. `existing` (the installed entry, or a lookup by id) adds the version and key differences, and refuses bundled or linked ids.

**i18n/**
- `pickLocale(preference, systemLocale)`: the user's choice, else the system language if there's a file for it, else English. `strings(locale)` fills gaps with English; `translator(locale)` returns `t(key, vars)`.
- `es.json` and `en.json` must have the same keys and placeholders; `test/i18n.test.js` checks that, and that every `t('…')`, `data-i18n` and `data-i18n-aria` in `main.js`, `desktop/` and `viewer/` exists.
- Viewer strings are the `viewer.*` keys. The server serves them at `GET /api/strings?lang=<navigator.language>`: the PC's chosen language wins, else the tablet's, else English.

**server.js**
- `startServer({ port, host, store, shardDirs, rulesFile, appVersion, keyboard, focus, devices, pairing, limiter, allowPublic, onAlert, confirmPairing })` returns a **promise** that resolves with the listening `http.Server`, or rejects if the port can't be used. Shards come from `store` (a `ShardStore`); without one, `shardDirs` are loaded as bundled shards. `keyboard` and `focus` can be injected (the tests use fakes); by default they are nut-js's `keyboard` and `./focus`, and nut-js is only loaded when no keyboard is injected. `devices`, `pairing` and `limiter` default to in-memory instances. The server object also gets `releaseAll()`, `setPaused(on)`, `isPaused()` and `store`.
- When the store changes it broadcasts `shards-changed` to every tablet; `setPaused()` broadcasts `paused`, releases held keys and ignores `press`/`down` (never `up`) while paused.
- Store events reach the tablets: `change` → `shards-changed`, `settings` → `{type:'settings', shard, values}`, `files` → `{type:'shard-files-changed', shard}`.
- **Live indicator:** each tablet reports the shard it has open (`{type:'open', shard|null}`). While any tablet has a shard limited to apps open, the server runs `focus.check` every `FOCUS_POLL_MS` (500 ms) and sends `{type:'focus', shard, ok, active, apps}` to each tablet **only when its state changes**. With no restricted shard open, nothing is polled.
- `allowAppsFromTablet` (boolean or function): a block then carries `canAllow` and the detected program's name, and the server remembers that program for 60 s. `{type:'allow-app', shard}` adds it with `store.addApp()` and answers `allowed`. The program always comes from the PC's own detection, never from the message.
- `confirmPairing({ name, ip })` may return `true` (accept now) or a promise: the tablet gets `pending` and waits up to 60 s (the auth timeout doesn't apply meanwhile); a refusal sends `pair-rejected` and closes with 4003.
- Every HTTP request must carry an allowed `Host` (`net.hostAllowed`: `localhost`, `127.0.0.1`, `[::1]`, `libreshard.local` or one of the PC's own addresses) and come from a private address (`net.isPrivateAddress`), unless `allowPublic`. Otherwise it gets a 403. All responses carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and the viewer's CSP (`default-src 'self'`, `script-src 'self'`, `connect-src 'self' ws://<host>`, `frame-ancestors 'none'`…).
- `GET /api/strings`: the viewer's strings (see i18n). Option `language` (string or function) is the PC's setting. It also answers `shardLang` (the PC's chosen language, else the tablet's raw `?lang=` if it looks like a language tag, else `locale`: a shard may ship languages the app doesn't) and `platform` (`windows`, `linux`, `mac`; option `platform`, default from `process.platform`), which the viewer passes to shards.
- Before typing, `unavailableKeys(combo)` (default `keys.unavailable`, injectable for tests) is checked; missing keys get `{type:'error', code:'key-unavailable', keys}` instead of being pressed, for `up` too (they were never pressed).
- `GET /api/shards`: `store.publicList()`: enabled shards with `id`, `name`, `author`, `icon`, `description`, `apps` (the effective apps; empty means no restriction) and `pending` (keys awaiting approval).
- `GET /shards/:id/*`: serves the shard's files with the shard CSP (which adds `frame-ancestors 'self'`). Paths with a segment starting with `.` (`..`, dotfiles) are refused, the path must stay inside the folder, and its **real path** must stay inside `realRoot`, so a link inside a shard can't expose other files while a shard folder that is itself a link (a development junction) still works. When serving `index.html` it appends `<script src="/shard-api.js">`.
- `GET /shard-api.js` and the static files in `viewer/` (dotfiles ignored).
- WebSocket on `/ws`: `verifyClient` requires an allowed `Host`, `Origin` equal to `http://<host>`, a private remote address and fewer than 32 connections. Messages are limited to 4 KB (`maxPayload`); an unauthenticated socket is closed after 10 s.
- Authentication: `{type:'auth', token}` is checked against `devices`; `{type:'pair', code|token, name}` consumes the current pairing code and creates a device. Only pairing attempts go through the `RateLimiter`; a wrong device token just closes the socket (tokens are 256 random bits, and limiting them would let an attacker lock real devices out). When the limiter's global threshold is crossed, `onAlert` is called. Removing a device (`devices.remove`) closes its sockets at once.
- Key messages: `shard` and `keys` must be strings of 1–64 characters. A token bucket allows 50 key messages per second per connection, but **`up` is never dropped**; more than 100 queued messages close the connection (1008). At most 10 combos can be held at once per connection.
- A key is typed only if it's in the shard's `allowed` set (declared **and** approved). App rules are resolved by the store (`resolveApps`: the user's rule in `app-rules.json`, otherwise the manifest's, otherwise none; an empty list or one with `"*"` means no restriction).
- Before running `press` or `down`, if `shard.apps` isn't empty, it calls `focus.check()`. If it doesn't match it replies `blocked` and doesn't touch the keyboard. `up` is never blocked.
- Each connection's messages are handled **in order** (one promise queue per socket). Without it, an `up` (which doesn't wait for `focus.check`) could run before its `down` on a quick tap and leave the key stuck.
- Every server-side WebSocket has an `error` listener: `ws` emits protocol errors (an oversized message, for example) there, and without one a single bad message would crash the app.

**pairing.js**
- `Pairing`: the current 6-digit code and QR token (16 random bytes). Both expire after 10 minutes or when used, rotate together, and emit `change`. `consume({ token } | { code })` compares in constant time.
- `Devices`: paired devices in a JSON file, `[{ id, name, tokenHash, createdAt, lastSeen, lastIp }]`. `add()` returns the device's token once and stores only its SHA-256; `verify()` compares every stored hash in constant time; `rename()` and `remove()` emit `change` (and `removed`).
- `RateLimiter`: per IP, 5 failures block for 30 s, doubling on each new block up to 15 min; a success resets the IP. Globally, more than 20 failures in a minute pause pairing for everyone for a minute and report an alert once.
- `cleanName()`: device names are plain text, without control characters, at most 60 characters, "Dispositivo" if empty.

**manifest.js**
- `validateManifest(m, { appVersion })` returns `{ ok, errors, manifest }`. It checks the id, the types and lengths of the text fields, `apps`, that every key in `permissions.keys` parses (at most 300), and `minAppVersion` against the running version. The returned manifest keeps only known fields, with keys normalized and deduplicated.
- `classifyKeys(keys)` sorts keys for the future install review: `dangerous` (combos with `win`/`meta`/`cmd`, `alt+f4`, any ctrl+alt), `canType` (10 or more plain characters plus `enter`) and `warning` (both at once, for example `win+r` plus typing).

**net.js**
- `hostAllowed(host)` and `isPrivateAddress(ip)` (loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 for Tailscale, `::1`, fc00::/7, fe80::/10, and IPv4-mapped IPv6). The PC's addresses are cached for 5 seconds.

**keys.js**
- `normalize(combo)`: lowercase, no whitespace.
- `parse(combo)`: splits on `+` and maps each part to a nut-js `Key`. Throws `Unknown key: …` if the key doesn't exist.
- Besides the usual keys it knows `print` (`printscreen`) and `numlock`.
- `unavailable(combo)`: the keys this system can't press safely. Only ever non-empty on Linux, for F13–F24 missing from the X keymap (checked with `xmodmap -pke`, cached for a minute; without xmodmap they count as missing). Pressing such a key makes Xlib abort the whole process.

**focus/**
- Providers all answer the same way: `name`, `available()`, `active()` → `{ exe, name, title, path }` and optionally `openWindows()`. `createFocus({ providers, cacheMs })` uses the first available one (`active-win`, then `linux-x11`, then `title`); the module itself exports a default instance.
- `linux-x11.js` asks the X server with `xprop` (`_NET_ACTIVE_WINDOW`, then `_NET_WM_PID`, `WM_CLASS`, `_NET_WM_NAME`) and reads `/proc/<pid>/exe`. It exists because on Linux npm silently drops active-win when there's no C++ toolchain, even though its Linux code needs none. `parseWindow()` is pure and tested on every OS.
- `check(entries)` returns `{ ok: true }` if any entry matches the foreground app, or `{ ok: false, reason, active, app }`: `reason` is `wrong-app` or `unknown`, `active` a readable description, and `app` the detected program (`{ exe, name, path }`, only when the provider knows it), so the user can allow it.
- `openApps()` lists programs with a visible window, once per executable (null if the provider can't list). `active()` is the raw detection (100 ms cache).
- `apps.js`: an entry is `{ exe, name, path? }` (exact executable, compared without folder, case or `.exe`, so it works across systems) or `{ match }` (case-insensitive "contains" on the program's name and executable, or on the window title when that's all the provider knows). Plain strings are read as `{ match }`.
- Fails closed: if the active window can't be detected, it blocks.

**viewer/index.html + viewer/app.js** (plain JS, no dependencies)

Views:
- `#lock`: pairing screen (6-digit code form `#pairForm`, input `#code`, message `#msg`).
- `#menu`: grid of cards, one per shard (icon, name, author, description). With no shards it shows an empty state with instructions.
- `#stage`: holds the open shard's iframe `#frame`, the floating button `#fab`, an invisible `#scrim` that catches taps outside the panel, and the panel `#panel`.
- `#offline`: "Sin conexión con la PC. Reconectando…" notice.

State: `ws`, `authed`, `shards`, `current` (id of the open shard or `null`) and `held` (held keys, as `shardId|keys`).

Behavior:
- **Strings first:** `viewer/app.js` fetches `/api/strings` before showing anything (`stringsReady`); static text in `index.html` uses `data-i18n` / `data-i18n-aria`, and everything else goes through `t()`.
- **Pairing and authentication:** a paired viewer keeps its device token in `localStorage` (`device-token`) and sends `{type:'auth', token}`. Without one, it pairs with the QR token (`?pair=…` in the URL, removed from the address bar with `history.replaceState`) or with the code typed in `#lock`, sending a readable `deviceName()` such as "iPad · Safari". On `paired` it saves the token.
- **Close codes:** `4001` with a token means the device was revoked: the token is deleted and, if a QR token arrived with the URL, it pairs with that instead. `4001` while pairing means a wrong or expired code or QR. `4002` means the old PIN login. `4029` shows "Demasiados intentos" with the wait from the preceding `error` message. Any other close shows the offline notice and retries every 1.5 s, but only with a saved token.
- **Migration:** a viewer that still has the old `pin` in `localStorage` deletes it and shows a message asking to scan the QR again.
- **Live updates:** `shards-changed` refetches the list (and leaves a shard that disappeared); `paused` (also in `ok`/`paired`) shows a gold strip and releases held keys; `pending` shows "waiting for the PC" on the pairing screen; close code 4003 means the PC rejected the device. Shards with `pending` show "Permisos pendientes" on their card.
- **Favorites:** menu cards of favorite shards show a gold ★; the menu and the floating panel follow the server's order.
- **Live indicator:** the viewer sends `open` when a shard opens or the menu shows (and again after reconnecting); `focus` with `ok: false` shows a gold strip at the bottom (`#focusbar`) naming the shard's apps and the app in front.
- **Settings relay:** answers the shard's `{t:'settings', id}` with the shard's values from `/api/shards`, and forwards `settings` messages from the PC to the open shard as `{__libreshard, t:'settings', values}`.
- **Development reload:** `shard-files-changed` for the open shard reloads its iframe (with a `&v=` to bypass the cache).
- **Language and system for shards:** every shard is loaded as `/shards/<id>/index.html?lang=<shardLang>&os=<platform>` (both from `/api/strings`); `shard-api.js` reads them.
- **Reconnection:** after the first sign-in, a new `ok` refetches `/api/shards` (`resync()`): shards or settings may have changed while the tablet was away (PC restarted, tab frozen in the background). The open shard gets its current settings, or the menu shows if it's gone.
- **Allow here too:** a `blocked` notice with `canAllow` gets a button "Permitir también en <app>" that sends `allow-app`; `allowed` confirms it.
- **Hash navigation:** `location.hash` is the open shard's id; empty means the menu. `route()` runs after authenticating and on every `hashchange`. Thanks to this, the tablet's Back button returns to the menu.
- **`showShard(s)`:** releases held keys, closes the panel, hides the menu and loads `/shards/<id>/index.html` into the iframe. It doesn't reload if it's already the open shard.
- **`showMenu()`:** releases keys, sets the iframe to `about:blank` (unloads the shard) and shows the menu.
- **Floating button:** 44×44 px, top left respecting `safe-area-inset`, semi-transparent at rest. Opens a panel with "Menú principal", "Pantalla completa" and, under "Cambiar a", the other shards (excluding the current one).
- **Zoom:** a "Zoom − 100% +" row in the floating button's panel (50%–200%, 10% steps; tapping the percentage resets to 100%). The iframe shrinks and is scaled with `transform`, so the shard reflows like with browser zoom. Saved per shard in `localStorage` (`zoom:<id>`).
- **Screen kept on:** while in full screen, `keepAwake()` uses `navigator.wakeLock` if available. It only exists in secure contexts (HTTPS or localhost) and the tablet uses `http://IP`, so the usual case is the fallback: loop `viewer/nosleep.webm` (2 s black video with silent audio). It starts inside the user's tap (from `toggleFullscreen`) and stops when leaving full screen.
- **Shard data:** answers the shard's `save`/`load` by storing a string (max 64 KB) in `localStorage` under `shard-data:<id>`, with the id taken from `current`.
- **Full screen:** a button in the menu header and an option in the floating button's panel. Uses the Fullscreen API (with the `webkit` prefix for Safari) on the whole viewer, so it persists across shard switches. The label changes to "Salir de pantalla completa" on `fullscreenchange`. If the browser doesn't support it (iPhone), the option is hidden.
- **Shard → PC bridge:** the `message` listener requires `e.source === frame.contentWindow`, `t` in `press|down|up` and a string `keys`. The shard id comes from `current`, never from the message. It records `down`/`up` in `held` and vibrates with `navigator.vibrate`.
- **Safe release:** `visibilitychange` (screen hidden) and `pagehide` call `releaseHeld()`, which sends `up` for every held key.
- **Blocked action notice:** on `blocked` it shows a notice (`#toast`, 4.5 s) with the allowed apps and the active app, and vibrates with a different pattern. Menu cards show "Solo en …" when the shard is restricted.
- **Untrusted content:** name, author, icon and description come from community manifests. The viewer renders them with `textContent` (never `innerHTML`), trims the description to 120 characters and uses only the first 2 characters of the icon.

**viewer/shard-api.js**
- Exposes `window.Shard` with `press`, `hold`, `release`, `save(data)`, `load()`, `settings()` (a promise with `{ id: value }`) and `onSettings(cb)` (called with the new values whenever the user changes them on the PC). `save` sends `{__shard, t:'save', data:<JSON>}`; `load` sends `{__shard, t:'load', id}` and the viewer answers the iframe with `{__libreshard:true, t:'data', id, data}`. `load()` returns a promise with the saved object or `null` (also if there is no answer within 1.5 s, for example with the shard opened on its own).
- It's injected **at the end** of the shard's `index.html`, after its own scripts: `window.Shard` exists from `DOMContentLoaded` on.
- Implements the declarative mode: delegates `click` on `[data-key]` and `pointerdown`/`pointerup`/`pointercancel` on `[data-hold]`. On `pointerdown` it captures the pointer (`setPointerCapture`), so `pointerup` reaches the same button even if the finger or mouse leaves it.
- **Second finger:** browsers only fire `click` for the primary pointer, so a `[data-key]` tapped while another finger holds a `[data-hold]` (Alt + Tab) is pressed on that pointer's `pointerup`, if it lifts over the same button.
- **`data-repeat`** on a `[data-key]`: presses on `pointerdown` and, while the finger stays, again every `data-repeat` ms (default 100, 50–1000) after a 400 ms pause; stops on `pointerup`/`pointercancel`, hidden page or blur. Its `click` is ignored (a keyboard click, `detail` 0, still presses). For keys an injected held press doesn't auto-repeat (volume, brush size).
- **Language and system:** `Shard.lang` (from `?lang=`, else `navigator.language`, lowercase) and `Shard.platform` (`windows`, `linux`, `mac`, or `''` when opened on its own). Optional translations: if the shard defines `window.SHARD_STRINGS = { en: {...}, es: {...} }` (in its own `strings.js`, loaded before `shard-api.js`), `[data-i18n]` (text) and `[data-i18n-aria]` (`aria-label`) are filled at load, `<html lang>` is set, and `Shard.t(key, vars)` / `Shard.translate(root)` serve JS. Lookup: exact language, its base, English, the key. Strings must be a script: the shard CSP forbids `fetch`. A shard without `SHARD_STRINGS` is untouched.

## 4. WebSocket protocol

The socket only opens with an allowed `Host`, an `Origin` equal to `http://<host>` and a private remote address. Messages are JSON, at most 4 KB.

Client to server:

| Message | When |
|---|---|
| `{ "type": "auth", "token": "…" }` | First message of a paired device |
| `{ "type": "pair", "code": "123456", "name": "iPad · Safari" }` | Pairing with the code typed by hand |
| `{ "type": "pair", "token": "…", "name": "…" }` | Pairing with the QR's one-time token |
| `{ "type": "press", "shard": "id", "keys": "ctrl+c" }` | Press and release |
| `{ "type": "down", "shard": "id", "keys": "shift" }` | Hold |
| `{ "type": "up", "shard": "id", "keys": "shift" }` | Release |
| `{ "type": "allow-app", "shard": "id" }` | After a block: add the program the PC detected to this shard's apps |
| `{ "type": "open", "shard": "id" }` | The tablet opened this shard (`null`: back to the menu); drives the live indicator |

Server to client:

| Message | Meaning |
|---|---|
| `{ "type": "ok", "device": { "id", "name" }, "paused" }` | Token accepted |
| `{ "type": "paired", "token", "device": { "id", "name" }, "paused" }` | Paired: the viewer must keep `token`, the server never sends it again |
| `{ "type": "pending" }` | Valid code, but the user must accept the device on the PC first |
| `{ "type": "error", "code": "pair-rejected" }` | The user rejected the device (then 4003) |
| `{ "type": "paused", "value": true }` | The PC was paused or resumed |
| `{ "type": "shards-changed" }` | Shards were installed, removed, approved, enabled or disabled: refetch `/api/shards` |
| `{ "type": "error", "code": "pair-failed" }` | Wrong or expired pairing code (the socket then closes with 4001) |
| `{ "type": "error", "code": "rate-limited", "retryAfter": 30 }` | Too many failed pairing attempts (then 4029) |
| `{ "type": "error", "code": "too-many-held" }` | Already holding 10 combos |
| `{ "type": "error", "code": "key-unavailable", "keys": "f13" }` | This PC's keyboard map has no such key (F13–F24 on many Linux setups); nothing was pressed |
| `{ "type": "denied", "shard", "keys" }` | The shard didn't declare that key |
| `{ "type": "allowed", "shard", "app" }` | The program was added to the shard's apps |
| `{ "type": "focus", "shard", "ok", "active", "apps" }` | The open shard became active (`ok`) or paused because another app is in front; sent only on changes |
| `{ "type": "settings", "shard", "values" }` | The user changed that shard's settings on the PC |
| `{ "type": "shard-files-changed", "shard" }` | A development shard's files changed: reload it if open |
| `{ "type": "error", "code": "allow-failed" }` | Nothing to allow (setting off, no recent block, another shard) |
| `{ "type": "blocked", "shard", "keys", "apps", "active", "reason", "canAllow"?, "app"? }` | The shard is limited to other apps (`apps` are readable labels). With `canAllow`, the tablet may answer `allow-app`; `app` is the detected program's name. `active` is what's in the foreground and `reason` is `wrong-app` or `unknown` |

Close codes: `4001` unknown or revoked device, wrong pairing code, or a message before authenticating; `4002` old PIN login (pair again); `4003` the PC rejected the device; `4008` no authentication within 10 s; `4029` rate limited; `1008` message flood; `1009` message too large.

Full flow of a tap:

1. The user taps `<button data-key="ctrl+shift+f13">` inside the iframe.
2. `shard-api.js` calls `parent.postMessage({__shard:true, t:'press', keys:'ctrl+shift+f13'}, '*')`.
3. The viewer checks that the message comes from the current iframe and sends `{type:'press', shard:'discord-basico', keys:'ctrl+shift+f13'}` over WebSocket.
4. The server checks that the socket is authenticated, that the message passes the rate limit and field checks, and that `ctrl+shift+f13` is in the shard's `allowed`.
5. If the shard has restricted apps, `focus.check()` checks the foreground app. If it doesn't match, the server replies `blocked` and the flow ends here.
6. `parse()` converts the combo and the server presses each key separately (modifiers first, 15 ms between keys), waits `TAP_MS` (60 ms) and releases them in reverse order.

Pairing flow:

1. The PC window shows one QR per network, each with the current one-time token, and a 6-digit code. The user scans whichever QR works with the tablet, or opens the viewer's address and types the code.
2. The viewer sends `pair`; the server checks the code, creates the device, rotates the code and answers `paired` with the device token, which the viewer keeps.
3. From then on the viewer signs in with `auth` and its token. The menu appears; tapping a card changes the hash to `#<id>` and opens the shard.
4. From the floating button the user can go back to the menu or jump to another shard.

## 5. Shard format

A folder with at least `manifest.json` and `index.html`. It can include CSS, images and local fonts.

```json
{
  "id": "my-shard",
  "name": "My shard",
  "author": "user",
  "version": "1.0.0",
  "icon": "⭐",
  "description": "One line for the menu card",
  "permissions": { "keys": ["ctrl+c", "ctrl+v", "shift"] }
}
```

- `id`: lowercase letters, digits and hyphens only. Must be unique. It's also the URL hash.
- `name`: shown in the menu and in the floating button's panel.
- `icon` (optional): an emoji or a letter. Without an icon, the name's initial is used.
- `description` (optional): one line for the menu card (120 characters max).
- `apps` (optional): list of applications where the shard may act (see below). Without this field, the shard acts in any app.
- `permissions.keys`: closed list of combos the shard may type. They are compared normalized.
- `author` is shown on the card. `version` is informational and not used in logic.
- `minAppVersion` (optional): the oldest LibreShard version the shard works with, such as `"0.2.0"`. On older versions the shard is skipped with an explanation. Shards published in their own repository should set it.
- Installing: the PC window installs from a `.zip`, a `.libreshard` (a zip with another extension, opened by double click once packaged) or a folder, after a review screen. A shard copied by hand into the shards folder also appears (hot reload), but its keys stay blocked until approved in the window.
- `settings` (optional): settings the user can change on the PC, read by the shard with `Shard.settings()` and `Shard.onSettings(cb)`. Up to 30, each `{ id, type, label, default, ... }` with type `toggle`, `select` (`options`: texts or `{ value, label }`), `number` (`min`, `max`, `step`), `text` (`maxLength`, up to 200) or `color` (`#rrggbb`). A label is a text or `{ "en": "...", "es": "..." }`. Values are always checked against the declaration; an invalid declaration rejects the shard.
- **Development mode:** "Load in development…" links a folder instead of copying it. Saving any file reloads the shard on the tablets showing it; changing `manifest.json` reloads its declaration (new keys need approval again).
- The manifest is validated when it loads: unknown keys, wrong types or a bad id make the shard be skipped (the PC window lists it). Text fields are trimmed to their limits (name 60, description 300…) and unknown fields are dropped.
- `size` is **deprecated**: it used to define cells in a grid, but now every shard takes the whole screen. It's ignored and dropped at load.

Usage from HTML/JS:

```html
<button data-key="ctrl+c">Copy</button>     <!-- presses on tap -->
<button data-hold="shift">Shift</button>    <!-- held while the finger is on it -->
<button data-key="volup" data-repeat>+</button>  <!-- presses, then repeats while held (data-repeat="150": every 150 ms) -->
<span data-i18n="title">My shard</span>      <!-- filled from window.SHARD_STRINGS if the shard has it -->
<script>
  Shard.press("f5");
  Shard.hold("shift");
  Shard.release("shift");
  // The shard's own settings (the iframe has no localStorage): the viewer stores them on the tablet
  document.addEventListener('DOMContentLoaded', async () => {
    const cfg = (await Shard.load()) || {};
    Shard.save({ ...cfg, theme: 'dark' });
    // The PC's system ('windows', 'linux', 'mac') and the language, for shards that adapt
    if (Shard.platform === 'linux') { /* ... */ }
    console.log(Shard.lang, Shard.t('title'));
  });
</script>
```

**Languages (optional).** A shard can be in one language only, or ship several: a `strings.js` with `window.SHARD_STRINGS = { en: {...}, es: {...} }`, loaded before the shard's own scripts, plus `data-i18n` / `data-i18n-aria` in the HTML and `Shard.t()` in JS. The viewer passes the language chosen on the PC, else the tablet's; missing texts fall back to English, then to the key. It must be a script, not a JSON file: the shard CSP forbids `fetch`. `name` and `description` in the manifest are plain text (the bundled shards use English).

**Template:** [docs/shard-template/](docs/shard-template/) is a minimal shard for authors, with the manifest explained in its README.

Supported keys (aliases in `keys.js`): letters `a-z`, digits `0-9`, `f1`-`f24`, `ctrl`, `shift`, `alt` (left; also `lctrl`, `lshift`, `lalt`), `rctrl`, `rshift`, `ralt` (right), `win`/`meta`/`cmd`, `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `insert`, `home`, `end`, `pageup`, `pagedown`, arrows `up/down/left/right`, `comma`, `period`, `minus`, `equal`, `grave`, `slash`, `backslash`, `semicolon`, `apostrophe`, `lbracket`, `rbracket`, numpad `numpad0`-`numpad9`, `numpadplus`, `numpadminus`, `numpadmul`, `numpaddiv`, `numpaddot`, `numpadenter`, `numlock`, `print` (also `printscreen`), and media `mute`, `volup`, `voldown`, `playpause`, `next`, `prev`. `+` separates keys, which is why numpad plus is written `numpadplus`.

### Limiting a shard to certain apps

So that a shard only acts in the apps it was designed for, add `apps` to the manifest:

```json
"apps": ["photoshop", "affinity photo"]
```

- These are suggestions: each string is a text rule, compared **case-insensitively and as a partial match** with the program's name and executable (`photoshop` matches `Adobe Photoshop 2025` and `Photoshop.exe`). Prefer specific strings (`adobe photoshop` rather than `ps`).
- If none matches, the PC doesn't run `press` or `down`, and the tablet shows a notice with the allowed apps and the app that was active. `up` (release) always runs, so no key is left stuck.
- If the active app can't be detected, the action is blocked.

**The user decides.** In the PC window, "Apps" on each shard opens an editor: "In any app" or "Only in these apps", adding programs from the open windows, with "Detect app", or as text. Programs are saved by executable, which is exact. From the tablet, a blocked tap offers "Permitir también en <app>" (setting "Allow apps from the tablet", on by default).

**User rules (`app-rules.json`).** What the editor saves, in `<userData>/app-rules.json`. It can also be edited by hand:

```json
{
  "photoshop-basico": {
    "mode": "only",
    "apps": [
      { "exe": "Photoshop.exe", "name": "Adobe Photoshop 2025" },
      { "match": "affinity photo" }
    ]
  },
  "multimedia": { "mode": "any" }
}
```

- The key is the shard's `id`. The user's rule **replaces** the manifest's; deleting it (or "Restore suggestions") goes back to the manifest.
- The old format (`"photoshop-basico": ["photoshop", "krita"]`, with `["*"]` or `[]` for any app) is still read.
- The file reloads on save; no restart needed. If it ends up with invalid JSON, the previous rules are kept, a warning is logged, and the editor refuses to save until it's fixed.

### Design rules for shard authors

- The shard takes **the whole tablet screen**. Design with relative units (`%`, `vw`, `vh`, `grid`, `flex`) so it works across sizes and orientations.
- **Keep the top-left corner free (about 64 px)**: the viewer's floating button is drawn on top. For example, `padding-top: 64px` on the main container.
- Buttons should be comfortable for a finger (at least ~48 px).

### Restrictions the server applies to shard content

CSP on every shard file:

```
default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'
```

Consequences for authors: no `fetch`, WebSocket or internet resources (no CDNs, no Google Fonts). Everything must live inside the shard folder or be embedded as `data:`.

### Bundled shards

All of them use `shard-base/` (`libreshard.css`, `libreshard.js`, copied in by `npm run shards:base`), English and Spanish texts in `strings.js`, and English `name`/`description`. Their combos were checked in the real apps (2026-11, Windows 11, Ubuntu 24.04 GNOME 46 on Xorg, XFCE 4.18); each `shard.js` says how.

| id | Name | Teaches | Notes |
|---|---|---|---|
| `multimedia` | Media | `data-repeat` (volume) | No apps restriction. |
| `teclado-numerico` | Numpad | `settings` (calculator/phone layout) | Numpad keys type digits only with Num Lock on (Windows and X11 turn them into navigation keys otherwise), so it has a Num Lock key. |
| `edicion-imagen` | Image editing | `settings` with a key map per program, `apps`, `data-hold` (hand, pick color) | Program: Photoshop, Affinity Photo, Krita, GIMP. GIMP 3.2 and Krita 5 checked; Photoshop and Affinity use their documented defaults, unchecked. Actions a program has no shortcut for are shown disabled (Krita's lasso). Replaces `photoshop-basico`. |
| `videollamadas` | Video calls | `settings` per program, two-tap confirm | Zoom (checked in its shortcut settings, not in a meeting), Teams and Meet (checked in meetings). Meet has no leave shortcut, so that button is off for it. |
| `escritorio` | Desktop | the risk review (`win`, `ctrl+alt`), `data-hold` + `data-key` (Alt + Tab), `Shard.platform` | System: auto/Windows/GNOME/XFCE. Windows ignores an injected Win+L, so "Lock" is off there. |
| `discord-basico` | Discord | global keybinds the user records with a "Send" button, `data-hold` push to talk | Key sets: Windows `ctrl+shift+F13–F17`, Linux `ctrl+shift+F1–F4, F6`. |
| `obs` | OBS Studio | same pattern as Discord; scene buttons and names from `settings` | Windows `ctrl+shift+F18–F22`, scenes `shift+alt+F13–F18`; Linux `ctrl+shift+F7–F11`, scenes `shift+alt+F1, F3, F5, F9, F11, F12`. The same combo on Start/Stop (or Mute/Unmute) makes one on/off key. |
| `desarrollo` | VS Code | plain `data-key`, `apps` | Format is `shift+alt+f` on Windows and `ctrl+shift+i` on Linux (Linux unchecked). |

`test/bundled-shards.test.js` loads them all (none rejected, every key parses), checks complete manifests, up-to-date base copies and matching `en`/`es` keys.

## 6. Security model

Principles that **must not be broken** when changing the code:

1. Permission checks live in the server (`server.js`), never only in the viewer.
2. The iframe must not get `allow-same-origin`. With it, the shard could reach the viewer's `localStorage` (where the device token lives) and its DOM.
3. The viewer identifies the shard by `e.source` and its own state (`current`), not by data in the message.
4. No shard can run shell commands or open programs. If that's ever added, it must be a separate, explicit permission that is visible at install time.
5. Shard files are resolved with `path.resolve` and checked to stay inside the shard folder.
6. All text coming from a manifest is rendered with `textContent`. Never `innerHTML` with community data.
7. The menu, the floating button and the panel live in the viewer, outside the iframe.
8. The foreground app check lives in the server and fails closed: if it can't determine the active app, it blocks. Releasing keys (`up`) is never blocked.
9. A shard's saved data is stored under the id from `current`, never under an id from the message, and has a size limit. A shard can't read another's.
10. There is no permanent shared secret. Pairing codes are short-lived and single-use; each device has its own token, and only its hash is stored. Every server-side check of a code or token is constant-time.
11. The server only answers to its own hostnames and addresses and, by default, to private networks; the WebSocket also requires the viewer's own `Origin`. This stops web pages in the PC's browser and DNS rebinding from reaching the socket.
12. Only pairing attempts are rate limited, never device tokens, so failing on purpose can't lock real devices out.
13. Every protocol limit (message size, rate, queue, held combos, connections) has a test. `up` is never dropped or blocked.
14. A user shard can only type keys the user approved (`shards-state.json`). The review shows every key, flags system combos and text typing, and never hides keys that were added since the last approval.
15. The desktop window has no Node access: everything goes through `preload.js` and IPC handlers that check the sender and every argument. Zips are extracted with path, symlink and size checks, and uninstalling never follows links.

Known limitations:

- Traffic is unencrypted HTTP/WS on the local network. Someone sniffing the network could capture a pairing code or a device token; the code expires quickly and the device can be revoked. HTTPS with a local certificate is left for later.
- A pairing confirmation dialog stays open if the tablet gives up or the 60 s pass; answering it then has no effect.
- If the app is killed abruptly while a key is held, the key stays pressed. A normal quit releases everything (`releaseAll`), and a dropped connection releases that socket's combos.
- Limiting a shard to certain apps **prevents mistakes, not attacks**. It protects against an accidental tap in the wrong app, but the shard's author writes the `apps` field and a malicious one can leave it out. What really protects is the key permissions validated by the agent and the user's review at install time. Also, the active app is checked right before acting; a few milliseconds pass between the check and the keypress.

## 7. Local development guide

Requirements: Node.js LTS and Windows, macOS or Linux (X11).

```bash
npm install
npm start          # opens the app and the server on the configured port (7878 by default)
npm test           # node:test suite, no extra dependencies
npm run test:linux # the suite plus real key injection and app detection on Linux (needs Docker)
npm run shards:base # after editing shard-base/: copies libreshard.css/.js into every bundled shard
```

Testing without a tablet: click "Open on this PC" in the app window (it pairs the PC's browser with the one-time token), or open `http://localhost:7878/` and type the code shown in the window. To debug a shard, use the browser's developer tools on the iframe.

What needs a restart:

- Changes in `viewer/`: just reload the tablet page.
- Changes only to a shard's HTML/CSS: reload the tablet.
- Changes in `app-rules.json`: reload on their own when saved (up to ~1 s).
- New shards, or changes to a manifest in the user's shards folder: picked up on their own (hot reload). Bundled shards (`shards/`) are read at startup.
- Changes in `config.json` or `devices.json` made by hand: restart the app. The Ajustes tab saves settings directly; port and public networks still need a restart (the window offers it).
- Changes in `desktop/`: restart the app (the window blocks navigation, reloads included).
- Changes in `main.js`, `server.js`, `shard-store.js`, `installer.js`, `pairing.js`, `manifest.js`, `net.js`, `focus/`, `keys.js` or `i18n/`: restart `npm start`.

Tests (`test/`):

- `keys.test.js`, `focus.test.js`, `net.test.js`, `pairing.test.js`, `manifest.test.js` and `migrate.test.js`: unit tests.
- `server.test.js`: starts the real server on a random port with a fake keyboard, a fake `focus` and an in-memory paired device (from `test/helpers.js`), and talks to it over WebSocket and HTTP: tokens, pairing, rate limiting, revocation, `Origin` and `Host` checks, headers, denied keys, blocked apps, `up` never blocked, release on disconnect and on quit, every protocol limit, manifest validation, repeated ids, path traversal through links and dotfiles, user rules and `EADDRINUSE`.
- When a test needs symlinks it creates junctions (`fs.symlinkSync(target, path, 'junction')`), which Windows allows without administrator rights.
- `bundled-shards.test.js` loads every bundled shard and checks manifests, keys, base copies (`tools/build-shard-base.js --check` does the same from the command line) and translations.
- `shard-store.test.js` and `installer.test.js` cover approvals, enable/disable, install/replace/refuse, uninstall through links, hot reload, and hostile zips (built by the tiny writer in `test/zip.js`, which real zip libraries won't do). `i18n.test.js` keeps the languages in sync.
- `test/linux/` builds a Debian image with Xvfb, openbox, xdotool and xmodmap, runs `npm test`, then `injection.js`: it opens an `xev` window (giving it `_NET_WM_PID` and `WM_CLASS`, which real apps set and active-win needs), checks detection by executable, and types combos one per process (`type-one.js`) to compare with what xev received. F13/F24 must come out as "refused" there, because Xvfb's keymap lacks them.
- **Ubuntu desktop VM:** `test/linux/proxmox-ubuntu-desktop-vm.sh`, run as root on a Proxmox host, creates an Ubuntu 24.04 VM from the cloud image, with GNOME on Xorg, automatic login, no screen lock, SSH by key and the test tools, then takes a `clean` snapshot. It uses Ubuntu's own kernel, so AppArmor's user namespace restriction applies, unlike in an LXC; that's what the `.deb` must be tested against.
- **Real tablet:** with USB debugging, `adb shell input tap X Y` taps and `adb exec-out screencap -p` captures the screen. `adb forward tcp:9333 localabstract:chrome_devtools_remote` exposes the tablet's Chrome to the DevTools Protocol, so the viewer page can be inspected (`document.elementFromPoint`, event listeners) like a desktop page.
- To drive the real desktop window (tabs, buttons, screenshots), start the app with `--remote-debugging-port=9223` and use the Chrome DevTools Protocol (`Runtime.evaluate`, `Page.captureScreenshot`).
- Every client a test opens is terminated afterwards, so a failing test can't leave `server.close()` waiting. The script runs with `--test-timeout=10000`.

Other notes:

- To see how the system names an app: "Detect app" in the apps editor, or `node -e "setTimeout(async () => console.log(await require('./focus').active()), 3000)"` and switch to that app within 3 seconds.
- The user's shards folder is shown in the app window. A new shard can be tested by copying it there without touching the project. For development, a directory link (junction/symlink) from that folder to the shard's working folder avoids copying; approve its keys once in the Shards tab, and again whenever it adds keys.
- If the tablet can't connect, check that the Windows Firewall allows Electron on private networks, that the network has no client isolation, and that you scanned the QR of the right interface.
- If a virtual adapter shows up that shouldn't, add its name to the `VIRTUAL` regex in `main.js`. If a VPN isn't marked as one, add it to `VPN`.
- When launching Electron from a VS Code terminal, `ELECTRON_RUN_AS_NODE=1` may be set and makes Electron run as plain Node. Unset it (`env -u ELECTRON_RUN_AS_NODE npm start`).

### Building the installer

```bash
npm run dist
```

`electron-builder` builds the installer for the system it runs on: `LibreShard-Setup-<version>.exe` (NSIS) on Windows, a `.dmg` on macOS, and `LibreShard-<version>.AppImage` plus `libreshard_<version>_amd64.deb` on Linux. Installers land in `dist/`. Add `--publish never` when building by hand.

- **Packaged files:** `build.files` in `package.json`. If you add a new file or folder, **add it there** or it won't reach the installer. Dependencies (like `qrcode`) are included automatically. `active-win` is unpacked from the `.asar` (`asarUnpack`) so its native binary can load. `LICENSE`, `NOTICE` and `LICENSES/` are packaged; electron-builder adds Electron's and Chromium's license files.
- **No native rebuild** (`npmRebuild: false`): active-win and libnut ship N-API binaries that load in Electron as they are. Without it, electron-builder 26 tries to compile active-win and needs Visual Studio.
- **Electron Fuses** (`build.electronFuses`): `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored by the packaged app, cookies are encrypted, only `app.asar` is loaded and its integrity is checked (Windows and macOS: a modified `app.asar` refuses to start, verified). `grantFileProtocolExtraPrivileges` stays at its default: the desktop window is a `file://` page inside the `.asar`, and without that fuse it fails with `ERR_FILE_NOT_FOUND`. Turning it off would need a custom protocol for the window.
- **Windows installer:** one-click, per user (`%LOCALAPPDATA%\Programs\libreshard`), no admin rights. `build/windows/installer.nsh` asks (Yes/No, English or Spanish by `$LANGUAGE`) whether to add a Windows Firewall rule for LibreShard on **private** networks only; yes runs `netsh` through a UAC prompt, and silent installs skip it. Uninstalling removes the rule (UAC again) and the `.libreshard` extension, but not during updates (`${isUpdated}`). The file is UTF-8 **with BOM**: NSIS reads files without one as ANSI and the Spanish text breaks.
- **Linux:** `desktopName` (`libreshard.desktop`) plus `linux.syncDesktopName` make the window's `WM_CLASS` match the `.desktop` entry, so docks group it with its icon.
- **Releases:** pushing a tag `v<version>` (it must match `package.json`) runs `.github/workflows/release.yml`: tests and installers on Windows, Linux and macOS (macOS may fail without blocking), then a **draft** GitHub release with the installers, `SHA256SUMS.txt` and the CHANGELOG section. A maintainer publishes the draft by hand. GitHub Actions are pinned by commit SHA. Code signing (SignPath) would slot in between the build and the draft.
- **CI:** `.github/workflows/ci.yml` runs `npm test` on Windows, Linux and macOS (macOS doesn't fail the run), `npm run test:linux`, and the DCO check on pull requests.
- **Testing a build without touching your data:** run `dist/win-unpacked/LibreShard.exe --user-data-dir=<empty folder> --remote-debugging-port=9225`. With an empty folder the app migrates a copy of the real data (see `migrate.js`); put a `config.json` there first (another port) to start clean.

### Creating a new shard (recipe)

1. Copy `docs/shard-template` (or a bundled shard) to a folder of your own.
2. Change `id`, `name`, `icon`, `description` and `permissions.keys` in the manifest.
3. In the PC window, Shards → "Load in development…" and pick the folder. Edit `index.html` (keep the top-left corner free): the tablet reloads on every save.
4. For a bundled shard, add the folder to `shards/`, run `npm run shards:base` (it copies the shared files in) and add its id to `test/bundled-shards.test.js`. Bundled shards are read at startup, so restart the app.

## 8. Gotchas

- **nut-js:** the project uses the community fork `@nut-tree-fork/nut-js`, because the official package stopped shipping free binaries. Don't switch it to `@nut-tree/nut-js`.
- **Elevated games:** on Windows, a game running as administrator ignores keys simulated by a normal process. LibreShard must run as administrator too.
- **macOS:** needs the Accessibility permission for the app.
- **Wayland (Linux):** nut-js key simulation may not work; X11 (or an Xorg session) is what's supported.
- **F13–F24 on Linux:** many X keymaps have no F13–F24 (the keys send XF86Tools, XF86Launch5…). nut-js then hits an X error and Xlib **aborts the whole process**. The server refuses those keys when `keys.unavailable()` says so; never press keys around that check. Shards meant for Linux shouldn't rely on F13+.
- **Android Chrome's per-site zoom:** when the user zooms the viewer's site in Chrome (the magnifier in the address bar), elements fixed to the **bottom** end up outside the visible area. The live indicator (`#focusbar`) therefore sits at the top, and is hidden while a notice (`body.toasting`) or the paused strip is showing.
- **Android Chrome and overlays on the shard:** the shard iframe is out of process, and taps on an element drawn over it fall through to the shard unless that element has its own compositing layer. `#toast` and `#fab` have `will-change: transform` for that (found with a real tablet; a JS `.click()` doesn't show it). Any new overlay above the iframe needs the same. Once, the very first notice after loading the page still let a tap through; it didn't happen again in later tries, so keep an eye on it.
- **Linux packaging:**
  - The `.deb` needs `author` (with an email) or `linux.maintainer`, and `homepage`, or electron-builder refuses to build it. Building it needs `ar` (`binutils`).
  - The `.deb` recommends `x11-utils` and `x11-xserver-utils` (`build.deb.recommends`).
  - **Ubuntu 24.04+ (AppArmor):** creating a user namespace still works there, so electron-builder's default post-install check (`unshare --user true`) leaves `chrome-sandbox` without SUID, but the namespace gets no capabilities and Chromium aborts at start ("SUID sandbox helper … not configured correctly"). `build/linux/after-install.tpl` (set as `build.deb.afterInstall`) keeps electron-builder's default script and, where `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` exists, installs `/etc/apparmor.d/libreshard` with `userns` for `/opt/LibreShard/libreshard`, as Ubuntu does for Chrome and VS Code. `after-remove.tpl` unloads and deletes it. Verified on a real Ubuntu 24.04 VM: without the profile the app aborts; with it, it starts with the normal sandbox. The templates use electron-builder macros (`${executable}`, `${sanitizedProductName}`); any other dollar-brace text in them breaks the build.
  - The `AppImage` needs FUSE (`/dev/fuse`). Containers such as LXC usually lack it; there, run it with `--appimage-extract-and-run`.
- **Linux packages:** nut-js needs `libxtst6`; active-win needs `xprop` and `xwininfo` (`x11-utils`); the F13+ check needs `xmodmap` (`x11-xserver-utils`).
- **Key names:** `keys.js` looks up `Key[name]` in nut-js's enum. If a key "doesn't exist", check its name in that version.
- **Config:** `<userData>/config.json` holds `port` and `allowPublicNetworks`. Deleting it restores the defaults on the next start.
- **Paired devices:** `<userData>/devices.json` holds token hashes. Deleting it (with the app closed) unpairs every device; they'll have to scan the QR again.
- **Public networks:** by default only private addresses can connect. Setting `allowPublicNetworks: true` in `config.json` lifts that; only do it behind a VPN or a firewall you trust.
- **Pairing codes rotate:** each code and QR works once and for 10 minutes. With two tablets, the second must scan the QR shown after the first one paired.
- **Port:** `7878` by default, changeable with `port` in `config.json` (1024–65535). If it's taken, the app shows a dialog and quits; there's no automatic fallback port, because paired tablets keep the old URL.
- **Single instance:** a second launch quits right away and focuses the first window. When testing, make sure no other LibreShard is running, or the new one will exit silently.
- **Testing close-to-tray:** `window.close()` from the page closes the contents directly and skips the window's `close` handler, so the app quits. Test with a real close (the X button, or `WM_CLOSE`).
- **Windows 11 Notepad:** `notepad.exe` is only a launcher; killing it leaves the real Notepad window open (and it restores the user's tabs). Close test windows gracefully (`CloseMainWindow`).
- **`replaceChildren(null)` inserts the text "null":** in `desktop/app.js`, use `fill()` (or `h()`), which skip null/false optional parts.
- **Desktop CSP:** the window forbids inline scripts and inline styles (no `style` attributes).
- **Pending approvals after updating:** shards that were in the user's folder before approvals existed (like the Star Citizen junction) start with every key pending. Approve them once in the Shards tab.
- **Viewer CSP:** the viewer forbids inline scripts. Put viewer code in `viewer/app.js`, never in a `<script>` block or an `onclick` attribute.
- **`ws` error events:** every server-side socket needs an `error` listener (see server.js), and so does the `WebSocketServer`. Without them, an oversized message or a listen error crashes the app.
- **Multiple IPs:** a PC usually has several interfaces (Wi-Fi, LAN, VPN, virtual adapters). That's why the window shows one QR per interface instead of guessing which one to use.
- **`user-select: none` on iOS:** the viewer disables text selection so long presses don't get in the way, and re-enables it only on `input`. If you remove it, the PIN can no longer be typed in Safari.
- **URL hash:** it must contain only the shard id (lowercase letters, digits and hyphens). The viewer doesn't use other route formats.
- **Reserved corner:** the floating button covers the shard's top-left corner; it's a dead zone for the shard's taps.
- **`active-win` is optional and native:** it's an `optionalDependency` (`active-win@8`; v9 is ESM-only). On Windows its install script downloads a prebuilt N-API binary (it works in Node and Electron alike). On Linux it installs (no binary needed) and uses `xprop`/`xwininfo`; verified under Xvfb by `npm run test:linux`. It needs the window to declare `_NET_WM_PID` and `WM_CLASS`, which normal apps do. Without it, `focus/` falls back to window titles.
- **npm install scripts:** npm 11 only runs install scripts approved in `allowScripts` in `package.json`. active-win is approved **for its exact version**: after upgrading it, run `npm install-scripts approve active-win` again or its binary won't download (it silently falls back to titles). Electron (since its 4x versions) has no install script: it downloads its binary the first time it runs (`npx electron`, `npm start`). `electron-winstaller` (Squirrel, unused) is denied.
- **npm audit:** what remains are build tools (electron-builder's chain), jimp's `file-type` (nut-js uses jimp for screen capture, which LibreShard never calls on outside files) and active-win's `node-gyp`/`tar`, which only run while installing. They're packaged (node-pre-gyp is needed at runtime to find active-win's binary), but never executed by the app.
- **Linux session end:** when the user logs out with LibreShard running, Chromium aborts ("D-Bus connection was disconnected", or "GPU process isn't usable" when every process gets SIGTERM at once) and Ubuntu records a crash report. It happened with the Electron 33 builds too. Data is safe (settings are written immediately); a clean fix (quitting when the session ends) is pending.
- **Title-based detection:** without `active-win`, only the window title is known, which can contain misleading text (a browser tab with "Photoshop" in the title). The apps editor then hides "Pick from open apps" and text rules match the title.
- **macOS and Wayland:** on macOS, reading the active window may need the Screen Recording permission, and on Wayland it may not work. In both cases, shards with apps are blocked (fail closed) until it's fixed or the restriction is removed with `["*"]`.
- **`mask-image` and `localStorage` in shards:** the iframe has no `allow-same-origin`, so its origin is opaque. `localStorage` throws (wrap it in `try`), and `mask-image` with a file from the shard may fail because it's requested with CORS; embed those masks as `data:` (as the external Star Citizen MFD shard does in its `icons.css`). `<img>` and `background-image` work with local files.
- **Combos in nut-js:** don't use `keyboard.pressKey(mod, key)` with several keys. nut-js sends modifiers as libnut "flags", which send RCtrl as the left Ctrl, and `releaseKey` reverses the order on its own, so reversing it again left the main key pressed. `server.js` presses and releases each key separately (`makeTyper`).
- **Press duration:** `press` holds the key for `TAP_MS` (60 ms, in `server.js`). At 0 ms, press and release arrived together and games that read the keyboard once per frame (Star Citizen) didn't see the key. For the game's "hold" actions use `data-hold`, which lasts as long as the finger is on it.
- **Game shards with unbound actions:** the `Star Citizen MFD` shard (separate repository, `libreshard-star-citizen`; not bundled with the app because it uses assets from CIG's fankit) maps each button to a game action (`layout.js`) and uses `tools/build-profile.js` to generate a control profile (still `LibrePad_MFD.xml` there, renamed when that repository is published) that binds the actions without a default key, plus the manifest's `permissions.keys`. It's the pattern to follow for other games with importable profiles.
- **100 ms cache:** if you switch apps and tap within that window, it may be evaluated against the previous app.
- **Two fingers in a shard:** a second finger's tap fires no `click` (only the primary pointer does); `shard-api.js` presses `[data-key]` on that pointer's `pointerup` instead. And `touch-action: manipulation` still allows pinch zoom, which cancels both pointers when a second finger lands: shard buttons need `touch-action: none` (the base styles set it on `.lp-btn`). Both were only visible with real multi-touch; CDP touch events reproduce them (in `Input.dispatchTouchEvent`, `touchEnd` lists the points that lift, not the ones that stay).
- **Win+L can't be injected on Windows:** the lock is handled by the logon process, which ignores synthetic input; the L arrives as a letter. Other Win combos (Win+D, Win+Tab, Ctrl+Win+arrows, Win+Shift+S) work.
- **Shortcuts taken by other programs:** a program that registers a global hotkey (`RegisterHotKey`) swallows that combo for everyone. On the development PC Ctrl+Shift+M/O/E were taken (probably AMD Software), so Teams' mute, camera and share shortcuts never arrived. To check a combo, try registering it: error 1409 means it's taken.
- **GNOME and Shift+Alt+F keys:** mutter matches Shift+Alt+F2/F4/F6/F7/F8/F10 as its Alt+F bindings (run, **close window**, cycle, move, resize, maximize). XFCE matches exact modifiers. Check combos for Linux with `xev` on both desktops before using them.
- **Global hotkeys and the foreground app:** Discord and OBS react to injected combos with another app in front, but Discord ignores its keybinds while its own settings are open. When testing this, make sure the "other app" really has the focus: a closed window means nothing was typed.
- **Numpad and Num Lock:** with Num Lock off, injected `numpad0`–`numpad9` and `numpaddot` act as navigation keys on Windows and X11; operators and `numpadenter` don't change.
- **F11 in VS Code** steps into a function only while debugging; otherwise it toggles full screen.

## 9. Roadmap

The work before the first release (security, shard installation, allowed-apps editor, distribution and bundled shards) was planned in the maintainer's local notes (`docs/plans/`, not published). The list below is the general roadmap, ordered by impact. Where to work is in parentheses.

1. ~~Shard hot reload~~: done (`ShardStore.watch`).
2. **Installing shards from a URL**: installing from `.zip`/`.libreshard`/folder with a review is done; a URL (and the gallery) would reuse `installer.prepare`.
3. **PWA mode** (`viewer/index.html`): `manifest.webmanifest` and icons already exist; installing still needs HTTPS. Full screen, zoom and keeping the screen on already exist.
4. **Menu improvements** (`viewer/index.html`): favorites and custom order are done (set on the PC); last shard used, search and categories remain.
5. **Live data for shards** (CPU, volume, active window): the server sends events and `shard-api.js` exposes them with `Shard.on('state', cb)`. Keep the principle that a shard only receives what it declares in its manifest (for example `permissions.telemetry`).
6. **HTTPS with a local certificate** (optional): pairing, attempt limits and per-device tokens are done; encrypting the local traffic is what remains.
7. ~~System tray icon~~: done, with open at login.
8. **Fixed network name** (`main.js`): advertise `libreshard.local` over mDNS (for example `bonjour-service`) alongside the QRs. Android doesn't always resolve it, so the QRs stay the main way in.
9. **Configurable floating button**: position, auto-hide after a few seconds, and size.
10. **Community gallery**: a GitHub repository with shards and a JSON index the app can list.
11. ~~Visual per-app rules editor~~: done (apps editor in the PC window, "allow here too" from the tablet).
12. ~~Live indicator~~: done (`open` / `focus`).
13. ~~Apps visible at install time~~: done (the review shows them and says when there are none).

## 10. Design decisions (so they aren't undone by accident)

- **Electron + JavaScript:** the same language for the app and the shards, and a single codebase to build installers for Windows, Mac and Linux.
- **Tablet as a browser, no app of its own:** works on iPad, Android or any device with a browser, and there's no mobile app to publish or maintain.
- **Shards in iframes with `sandbox` and CSP:** lets the community write HTML/CSS/JS freely without giving it access to the PC or the network.
- **Validation in the agent:** the list of allowed keys is declared in the manifest and enforced by the server.
- **Full-screen shards with a menu:** replaced the first version, which showed every shard at once in a grid of small cells. That's why `size` is deprecated.
- **One QR per network interface:** a tablet can't probe IPs until it reaches the PC, so every plausible one is shown and the user scans whichever works.
- **Hash as the route:** simple, works with the Back button and needs no server logic.
- **Allowed apps per shard, validated on the PC and failing closed:** avoids firing shortcuts into the wrong app. Detection goes through providers: `active-win` (program and executable) when available, window titles otherwise.
- **Rules by executable:** picking a program saves its executable, which is exact and doesn't depend on window titles or translated program names. Text rules remain for manifests and for systems that only know titles.
- **"Allow here too" uses what the PC detected:** the tablet can only say yes to the last block of that shard within a minute; it can never name a program itself.
- **`up` is never blocked:** releasing a key is always safe and avoids stuck keys if the foreground app changed in the middle of a held press.
- **User rules replace the manifest:** the user overrides the shard's author, and can extend it to other apps or remove the restriction without editing the shard.
- **No automatic fallback port:** paired tablets keep the URL with the port, so silently moving to another port would break them. The user changes it on purpose.
- **Injectable keyboard and focus in `startServer`:** lets the tests run the real server without typing on the developer's keyboard.
- **Pairing instead of a PIN:** a permanent PIN had to be stored, travelled in every QR and couldn't be revoked per device. Short-lived codes plus per-device tokens remove the stored secret (only hashes) and make revocation possible.
- **Approvals saved per shard:** reading permissions from the manifest on every start meant anyone who could edit a file could add keys silently. Now the user approves exactly the keys shown in the review.
- **Native dialogs for destructive or security questions** (unpair, uninstall, confirm a device): they can't be faked or clicked by page content.
- **First shard id wins:** the user can no longer override a bundled shard by reusing its id; to customize one, copy it with a new id.

## 11. Conventions for anyone changing the code

- Plain JavaScript with CommonJS (`require`) in the agent and framework-free JS in the viewer, with no transpiling or bundler. Keep it simple.
- Minimal dependencies: today only `express`, `ws`, `qrcode`, `yauzl` (zip reading with entry-by-entry control, chosen over `adm-zip`, which loads everything in memory and had zip-slip bugs) and `nut-js`. Justify any addition. Tests use `node:test`, with no test framework.
- Comments in English. All UI text through `t()` and `i18n/*.json` (both languages, same keys); viewer keys start with `viewer.`.
- Run `npm run test:linux` after touching keys, focus detection or anything platform-specific.
- The bundled shards must work with `data-key` / `data-hold` (shard.js may only fill them in from settings), to show off the declarative mode. They take no third-party material (logos, images, licensed fonts): icons come from `shard-base/icons.js`.
- Any change to the WebSocket protocol, the manifest format or the shard rules must update sections 4 and 5 of this file.
- Run `npm test` before considering a change done, and add tests for new server behavior.
- Before accepting a new feature, check that it doesn't weaken any of the principles in section 6.
- New files are Apache-2.0 (no per-file header needed). Files in `shard-base/` and `docs/shard-template/` are MIT-0 and keep their `SPDX-License-Identifier: MIT-0` line. Commits carry a DCO sign-off (`git commit -s`).
- Public docs (README, SECURITY, CONTRIBUTING, docs/shards.md, CHANGELOG) are in English; `README.es.md` mirrors the README. Add user-visible changes to `CHANGELOG.md` under "Unreleased".
