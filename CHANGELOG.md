# Changelog

All notable changes to LibreShard are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Project

- Code of conduct (Contributor Covenant 3.0), with reports to conduct@libreshard.com.

## [0.2.0] - 2026-11-04

### App

- **This PC** panel, for touch screens on the PC: a card next to the QR codes opens the shards in a
  window that never takes the focus, so the keys still go to the app in front. It remembers where
  it was left and can stay on top. It signs in as a "This PC" device, without a code, and only from
  this machine. While LibreShard itself is in front, its taps press nothing and it says so.
- On Linux the panel has its own title bar to move it, a corner to resize it and a close button
  (the desktop can't manage a window that never takes the focus there), and always stays on top.
- The "Open on this PC" button (the viewer in the system browser) is gone: the browser takes the
  focus, so the keys landed in it.

### Tablet viewer

- Picking a shard from the menu opens it full screen. A gear in the menu header opens "This
  device", where each tablet can turn that off.

### Project

- Website at [libreshard.com](https://libreshard.com), with the downloads for each system. Security
  reports go to security@libreshard.com.
- The README shows the roadmap.

## [0.1.0] - 2026-11-03

First public release.

### App

- Desktop window with four tabs: Connect (one QR per network and a pairing code), Devices, Shards and
  Settings, plus a Pause button that stops every keypress at once.
- Tray icon, "keep running in the tray when closed" and "open at login".
- English and Spanish, following the system language (or chosen in Settings).
- Windows and Linux (X11) supported; macOS experimental.

### Pairing and security

- Each tablet pairs once with a single-use code or QR (valid for 10 minutes) and gets its own
  token; the PC stores only its hash. Devices can be renamed and unpaired one by one, and new
  devices can require confirmation on the PC.
- Only private networks by default, allowed hostnames only (DNS rebinding protection), `Origin`
  check on the WebSocket, rate-limited pairing, and limits on message size, rate and held keys.
- Every key is released when the app quits.

### Shards

- Install from a `.zip`, a `.libreshard` file or a folder (drag and drop or buttons), with a
  review screen that shows every key, flags system shortcuts and shows what changed on updates.
- Keys only work if they're declared in the manifest **and** approved on the PC.
- Hot reload, enable/disable, uninstall, favorites and menu order (set on the PC).
- Per-shard settings defined in the manifest and edited on the PC, with live updates.
- Development mode: link a folder and the tablet reloads on every save.
- "Only in these apps": a visual editor that picks programs by executable, "Detect app", and
  "Allow here too" from the tablet.
- Live indicator on the tablet when the shard's app isn't in front.
- Eight bundled shards: Media, Numpad, Image editing, Video calls, Desktop, Discord, OBS Studio and
  VS Code.

### Packaging

- Windows installer per user (no administrator rights), with an optional firewall rule for private
  networks only.
- Linux `.deb` (with an AppArmor profile for Ubuntu 24.04 and newer) and AppImage.
- Electron Fuses: no `ELECTRON_RUN_AS_NODE`, no inspector flags, and `app.asar` integrity checks.

[Unreleased]: https://github.com/libreshard/libreshard/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/libreshard/libreshard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/libreshard/libreshard/releases/tag/v0.1.0
