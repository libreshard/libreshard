# Security

LibreShard presses keys on your PC when someone taps a tablet. That's powerful, so this page
explains what LibreShard protects against, what it doesn't, and how to report a problem.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Instead:

- Use GitHub's private reporting: **Security → Report a vulnerability** in the
  [repository](https://github.com/libreshard/libreshard/security/advisories/new), or
- write to **security@libreshard.com**.

Include the LibreShard version, your operating system and the steps to reproduce it. You'll get an
answer within a week. LibreShard is maintained by volunteers, so fixes may take a while, but we'll
keep you informed and credit you in the release notes if you want.

Only the latest release gets security fixes.

## What LibreShard protects

LibreShard has two halves: an app on your PC (the **agent**) that runs a small web server and
presses keys, and a **viewer** web page on the tablet. **Shards** are panels made of HTML, CSS and
JavaScript, written by anyone, that run inside the viewer.

| Threat | Protection |
|---|---|
| A shard tries to press keys it didn't declare | The agent only presses keys listed in the shard's `manifest.json` **and** approved by you on the PC. The check is in the agent, not in the tablet. |
| Someone edits a shard's manifest to add keys | New keys stay blocked until you approve them again in the PC window. |
| A shard installed from someone else does something dangerous | Before installing, the PC shows every key, marks system shortcuts (Windows key, Ctrl+Alt) in red and warns when a shard can both open a system dialog and type text. |
| A shard tries to reach the internet, your PC, other shards or the tablet's saved token | Shards run in a sandboxed iframe without `allow-same-origin`, under a Content Security Policy with no network access. They can only send "press this key" messages to the viewer. |
| Another device on your network tries to connect | Each tablet pairs with a single-use code (or QR) that expires in 10 minutes, then gets its own token. The PC stores only a hash of each token. Failed pairing attempts are rate limited, and any device can be unpaired on its own. You can also require confirming every new device on the PC. |
| The **This PC** panel, which signs in without a pairing code | The app creates that one device itself, and the server only accepts it from the same machine (a loopback address), so its token is useless from anywhere else. While LibreShard's own window is in front, the panel's taps press nothing, so they can't change LibreShard's settings or approve keys. |
| A web page open in your PC's browser tries to control LibreShard | The server only answers requests addressed to its own hostnames and addresses (this stops DNS rebinding), and the WebSocket requires the viewer's own `Origin`. |
| Connections from outside your home network | By default only private addresses (LAN, link-local, Tailscale's range) can connect. On Windows, the installer offers a firewall rule for private networks only. |
| Oversized or flooding messages | Messages are limited in size and rate; floods close the connection. Releasing a key is never dropped, so no key stays stuck. |
| A malicious shard zip | Archives are extracted with checks for path traversal, links, size and file count. |

The full list of rules the code must keep is in [CONTEXT.md §6](CONTEXT.md#6-security-model).

## Known limitations

These are documented on purpose. Keep them in mind:

- **Local traffic isn't encrypted.** The tablet talks to the PC over plain HTTP and WebSocket. Someone
  who can sniff your network could capture a pairing code (it expires within minutes) or a device
  token. If you suspect that, unpair the device in the PC window. Use LibreShard on networks you
  trust; HTTPS with a local certificate may come later.
- **"Only in these apps" prevents mistakes, not attacks.** Limiting a shard to certain programs
  stops an accidental tap from firing shortcuts in the wrong app. A malicious shard author can simply
  leave the restriction out. What protects you is the key review at install time.
- **Running LibreShard as administrator** (needed for games that run elevated on Windows) gives the
  keys any shard presses the same power. Only do it if you trust every installed shard.
- **A shard's keys can still do a lot.** A shard approved for the Windows key, letters and Enter
  could open the Run dialog and type a command. The review warns about this combination; read it.
- **Public networks.** The advanced setting that accepts connections from public addresses removes
  one layer of protection. Only use it behind a VPN or a firewall you trust.
- **Killing the app abruptly** while a key is held can leave that key pressed. A normal quit releases
  every key.
- **Tablets can type into LibreShard's own window.** Only the This PC panel is stopped while
  LibreShard is in front. A tablet whose shard has keys like Tab and Enter approved could press
  buttons in LibreShard's window if it's the app in front (its dialogs default to Cancel or Reject).
  Extending the block to every device is planned for 0.3.
- **On Linux, Chromium's storage isn't encrypted with the desktop keyring** (`--password-store=basic`),
  so opening the panel never asks to create one. LibreShard keeps no secrets there.
- **Wayland (Linux) and macOS** are not fully supported: detecting the app in front may fail there,
  in which case shards limited to certain apps are blocked rather than allowed.

## Privacy

LibreShard sends no data anywhere. There's no telemetry, no account and no cloud service: the app
only talks to the devices you pair on your own network. Shards can't reach the network either.

To help with bug reports, the app keeps a log on your PC (`logs/libreshard.log` in its data folder).
It never leaves the PC unless you copy it into a report yourself, and it holds no keys typed, window
titles, device names or network addresses.
