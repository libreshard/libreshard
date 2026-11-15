# Changelog

All notable changes to LibreShard are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Project

- **Selling your shard:** a new guide, [docs/selling-shards.md](docs/selling-shards.md), on what
  LibreShard does and doesn't do for paid shards (no copy protection, and why), a personal-use
  license to start from, packaging, shops, and listing a paid shard in the gallery.

### App

- **New versions of your shards:** the daily check for new versions also reads the gallery's list
  when you have shards installed (the same setting turns it off). A shard from the gallery, or the
  same shard by the same author installed from its file, shows "Version x available" on its card:
  **Update** downloads the reviewed file and shows what changed first, and a paid one links to its
  author's shop. A shard taken out of the gallery says so. Nothing updates by itself.
- **Gallery:** "Explore the gallery" in the Shards tab lists shards reviewed for LibreShard, with
  search and categories, their keys, apps and license, and whether they're free or paid, installed,
  or have a newer version. Installing downloads the file its author published and only goes ahead if
  it's exactly the file that was reviewed, then shows the usual review. Paid shards open their
  author's shop. A web page can also link to an entry (`libreshard://install?gallery=<id>`). Shards
  are published through the [libreshard/shards](https://github.com/libreshard/shards) repository.
- **A tidier Shards tab:** the gallery and "New shard" lead as two large buttons, and the rest is
  grouped, with icons, into "Install a shard" and "For shard authors".
- **Shards are only shown to paired devices:** the list of your shards and their files were
  served to any device on your network; now only to paired ones. Each tablet gets a session token
  when it signs in, kept while it's connected and for 10 minutes after (a short disconnection
  doesn't interrupt the open shard), and gone at once when you unpair it.
- **Install links:** a web page can offer a shard with a `libreshard://install?url=…` link. LibreShard
  asks before downloading ("A web page wants to install a shard from …"), then shows the usual
  review; nothing is installed without both. Works where LibreShard was installed with its
  installer or `.deb` (not the AppImage).
- **Install from a web address:** "Install from URL…" in the Shards tab downloads a `.libreshard` or
  `.zip` from an `https://` address and shows the usual review, with the server it came from. Only
  servers on the internet: LibreShard refuses addresses on your own network (checking where it
  really connects), and stops at 50 MB or 60 seconds. The shard's card remembers where it came from.
  This is LibreShard's second kind of connection outside your network, and it only happens when you
  ask.
- **License and page of a shard:** a shard's manifest can say its license (`"license": "MIT"`, as
  an SPDX identifier) and its page (`"url"`, https only). The install review and the shard's card
  show the license, and a "Shard's page" button opens the page. Nothing of it reaches the tablet.

## [0.4.1] - 2026-11-15

### App

- The editor makes shards, so it says so: **New shard** (was "New panel"), the **Shard editor**, and
  an **Editor** badge on the cards of shards made with it. "Panel" now only names This PC's touch
  panel. Shards made in 0.4.0 keep working as they are.
- A button imported from a Stream Deck profile without an action no longer keeps saying why
  once you give it one: the note goes away when you choose what it does.
- Backups and exported shards carry the date they were made. Before, zip tools showed every file
  in them as dated 1980-00-00.

## [0.4.0] - 2026-11-14

### App

- **Panel editor:** make your own panel without writing code. **New panel** in the Shards tab
  opens it in its own window: a grid (up to 24×24) with pages, where each button presses a key,
  holds it, repeats it while held, toggles between two keys, opens another page or just shows
  text, and can span several cells. Give it a text, one of LibreShard's icons or an emoji, and
  colors. Keys are captured from the keyboard or picked from a list (for Win, media keys and F13 to
  F24), with the same warnings as the install review. A combo can hold several keys, pressed in
  order: Alt + Num 1 + Num 6 + Num 4 types ñ with a Windows Alt code. The preview draws the panel exactly as the
  tablet will, in landscape, portrait or phone size, and warns about buttons too small for a
  finger. Saving installs it like any shard, with its keys approved, and tablets showing it reload.
  **Edit** on a panel's card opens it again, also for panels made on another PC.
- **Images on panel buttons:** in the panel editor, a button's icon can now be your own image (PNG,
  JPEG, WebP or a GIF's first frame). It's shrunk to 288 px and saved again as PNG, so nothing but
  the pixels ends up in the panel, and its text goes over it. A button can also have a
  **background image** that covers it (up to 640 px), under its icon and text; pressing it lays the
  pressed color over the image.
- **Panel looks:** the panel editor's new **Look** tab has five themes (LibreShard, Light, High
  contrast, OLED black and Key pad) and settings over them: the background (a color, a gradient or
  an image you can darken), the buttons' corners, border, fill, shadow, colors and how images sit
  in them, the page tabs (with their own colors for the selected page), the spacing, and the text's color, size and font.
  **Back to the theme** drops your changes, and the editor warns when text and buttons are hard to tell apart.
- **Import a Stream Deck profile:** "Import Stream Deck profile…" in the Shards tab (or dropping a
  `.streamDeckProfile` file on the window) turns a profile exported from the Stream Deck app into
  a panel and opens it in the editor, unsaved. Pages, folders, labels (with their place, size and
  color) and images come along, and so do hotkeys, hotkey switches, media keys and page buttons.
  What can't be imported (plugin actions, typing text, opening programs, multi actions, key
  sequences, Stop) keeps its label and image without an action, marked ✕ with the reason in its
  note; Mac shortcuts become Ctrl and are marked ? to check. A summary says how many buttons work.
  The profile stays on your PC.
- **Export a shard:** "Export…" on the card of any shard you installed (panels included) saves it
  as a `.libreshard` file to share; a double click opens it in LibreShard on another PC. Hidden
  files and links are left out, and a panel with images from a Stream Deck profile asks first.
- **Make a shard with an AI assistant:** a new guide, [docs/ai-assistant.md](docs/ai-assistant.md),
  explains when the panel editor is enough, what to give an assistant (the shard guide and the
  template), a prompt to start with, how to try the result with "Load in development…" and which
  keys to check before approving them. The Shards tab links to it ("Something more than a grid of
  buttons?").
- Installing a new version of a shard you already have keeps it where it was: favorite, place in
  the menu, turned off and its settings. Before, they went back to the defaults.

### Project

- The README shows the panel editor, the Stream Deck import, exporting and the AI assistant guide.

## [0.3.0] - 2026-11-12

### App

- **New version notice:** once a day LibreShard asks GitHub which release is the latest and, if it's
  newer, shows a notice with a link to the download page (it never installs anything by itself).
  It sends nothing about you or your devices, and can be turned off in Settings, where "Check now"
  and the result sit too. Versions still being tested (pre-releases) aren't announced.
- **Backup** (Settings): export your settings, app rules, shard order and settings, and the shards
  you installed to one file, and import it on another PC. Importing shows what would change first
  (security settings highlighted), and every shard goes through the usual key review again. Paired
  devices and key approvals are never included.
- **About** at the end of Settings: version, license and links to the website, the source code and
  the security policy.
- **Report a bug** (Settings): copies the diagnostics and opens the bug report form on GitHub with
  your version and system filled in; paste the diagnostics in the last field and read them before
  sending. **Copy diagnostics** and **Open logs folder** sit next to it. The diagnostics hold the
  versions, settings, shards and the last lines of the log, never device names or network
  addresses.
- LibreShard keeps a log on the PC, `logs/libreshard.log` in its data folder (rotated, 3 MB at
  most), to help with bug reports. It records what the app did and what went wrong, never keys
  typed, window titles, device names or network addresses.
- **Apps running as administrator (Windows):** Windows silently drops keys sent to them unless
  LibreShard runs as administrator too. Now the tablet says so ("… runs as administrator") instead
  of tapping for nothing. Apps LibreShard can't inspect, such as some anti-cheats, work as before.
  The diagnostics also say whether LibreShard itself runs as administrator.
- The **This PC** panel now stays on top of other windows by default. Only new installs change:
  if you already used 0.2, your setting stays as it was (turn it on in Settings).
- **Linux:** logging out with LibreShard running no longer makes it crash (Ubuntu showed a crash
  report, and keys held from a tablet weren't released). On GNOME and XFCE, LibreShard now notices
  the session ending and quits first.
- With "Confirm new devices" on, the question on the PC now closes by itself when the tablet stops
  waiting or after 60 s. Before, it stayed open and answering it did nothing.
- A shard install that stops halfway (a zip over the size limit, for example) no longer leaves a
  temporary folder behind on macOS.

### Tablet viewer

- When LibreShard is updated on the PC while a tablet keeps the page open, the tablet says so and
  offers **Reload** (it never reloads by itself). This works from 0.3 on: a tablet showing the 0.2
  page needs one manual reload.
- The **This device** sheet (the gear in the menu) shows the LibreShard version, and is now
  available on every device, iPhone included.

### Security

- No device types into LibreShard's own window anymore. Before, only the This PC panel was stopped
  while LibreShard was in front, so a tablet with Tab and Enter approved could press buttons in its
  window or dialogs. Now every tablet gets the "LibreShard is in front" notice instead.
- The check for new versions is LibreShard's first connection outside your network. It's described
  in SECURITY.md (Privacy) and can be turned off.
- The PC answers at most 1000 HTTP requests per minute from each address (the viewer and shard
  files); past that it replies 429 until the minute is over. Keys over the WebSocket aren't
  affected.
- The script injected into shards ignores replies whose id it isn't waiting for.

### Project

- Each version is published first as a pre-release while people try it, and becomes a release
  afterwards. The app and libreshard.com only offer releases.
- A bug report form on GitHub, and private reporting for security problems.
- Code of conduct (Contributor Covenant 3.0), with reports to conduct@libreshard.com.
- Signed Windows builds and automatic updates move to 1.0.

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

[Unreleased]: https://github.com/libreshard/libreshard/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/libreshard/libreshard/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/libreshard/libreshard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/libreshard/libreshard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/libreshard/libreshard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/libreshard/libreshard/releases/tag/v0.1.0
