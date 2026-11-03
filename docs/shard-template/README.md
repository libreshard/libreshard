# Shard template

A minimal LibreShard shard: copy this folder, rename it, and change the manifest and the buttons.
To try it while you edit, open LibreShard on the PC → **Shards** → **Load in development…** and pick
the folder: every time you save, the tablet reloads it.

## manifest.json

JSON has no comments, so here is the template's manifest explained:

```jsonc
{
  "id": "my-shard",           // lowercase letters, digits and hyphens; unique; also the URL hash
  "name": "My shard",         // shown in the tablet's menu
  "author": "Your name",
  "version": "1.0.0",         // informational
  "minAppVersion": "0.1.0",   // the oldest LibreShard it works with (older ones skip it)
  "icon": "⭐",               // an emoji or a letter for the menu card
  "description": "One line for the tablet's menu",
  // "apps": ["photoshop"],   // optional: only act while one of these programs is in front
  // "settings": [ ... ],     // optional: settings the user changes on the PC (see docs/shards.md)
  "permissions": {
    "keys": ["ctrl+c", "ctrl+v", "shift"]  // every combo the shard may press; nothing else is typed
  }
}
```

The user reviews these keys when installing the shard. Combos with the Windows key or Ctrl+Alt show
up in red as system shortcuts.

## index.html

- `data-key="ctrl+c"` presses a combo on each tap. Add `data-repeat` to keep pressing it while the
  finger stays on the button (volume, brush size…).
- `data-hold="shift"` holds a key while the finger is on the button.
- From JavaScript: `Shard.press()`, `Shard.hold()`, `Shard.release()`, `Shard.save()`/`Shard.load()`
  and `Shard.settings()`. `window.Shard` exists from `DOMContentLoaded` on.

Design rules: the shard takes the whole screen, so use relative units; keep the top-left corner
(about 64 px) free for the viewer's floating button; make buttons at least 48 px; and check it in
portrait and landscape. Everything must live in the folder: shards can't load anything from the
internet.

## libreshard.css and libreshard.js (optional)

LibreShard's own look: `.ls-app`, `.ls-head`, `.ls-title`, `.ls-btn` (with `--accent`, `--gold`,
`--danger`), `.ls-key` for a combo under a label, and icons as `<span class="ls-i i-copy"></span>`
(the list is in `shard-base/icons.js` in the LibreShard repository). `libreshard.js` adds small helpers
used by the bundled shards (`LS.setKey`, `LS.keyLabel`, `LS.settings`, `LS.confirmTap`).

## Languages (optional)

A shard can be in one language only. To ship several, add a `strings.js` that sets
`window.SHARD_STRINGS = { en: { title: 'My shard' }, es: { title: 'Mi shard' } }`, load it before your
own scripts, and mark texts with `data-i18n="title"` (or `data-i18n-aria` for `aria-label`). LibreShard
fills them in the tablet's language (or the one chosen on the PC), with English as the fallback.
`Shard.lang` is that language and `Shard.t('title')` translates from JavaScript.

## More

The full guide for shard authors is
[docs/shards.md](https://github.com/libreshard/libreshard/blob/main/docs/shards.md) in the LibreShard
repository.

## License

This template, `libreshard.css` and `libreshard.js` are under MIT No Attribution (MIT-0): copy and
change them freely, no notice needed. The shard you build from them is yours. Replace this README
with your own, and add a `LICENSE` file with the license you choose.
