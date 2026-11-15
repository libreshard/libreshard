# Make a shard with an AI assistant

A shard is a small web page (HTML, CSS and JavaScript) plus a `manifest.json` with the keys it may
press. AI assistants such as ChatGPT, Claude, Gemini or Copilot are good at writing exactly that
kind of page, so you can describe the panel you want and let an assistant write it, even if you
have never written code.

This guide explains what to give the assistant, a prompt you can copy, how to try the result, and
what to check before you use it.

- [Do you need an assistant?](#do-you-need-an-assistant)
- [What to give the assistant](#what-to-give-the-assistant)
- [A prompt to start with](#a-prompt-to-start-with)
- [Try it while you refine it](#try-it-while-you-refine-it)
- [Check the keys before you approve them](#check-the-keys-before-you-approve-them)
- [When something doesn't work](#when-something-doesnt-work)
- [Privacy and ownership](#privacy-and-ownership)

## Do you need an assistant?

Often you don't. **New panel** in the Shards tab opens the panel editor: a grid of buttons with
pages, icons, images, colors and themes, where each button presses, holds or repeats a key,
switches between two keys or opens another page. If that's what you want, use the editor: it's
quicker and there's nothing to check. **Import Stream Deck profile…** turns an existing Stream
Deck profile into such a panel.

An assistant is worth it when you want something a grid can't do, for example:

- a layout of your own: a big jog wheel in the middle, a keyboard-shaped pad, buttons of different
  shapes, sections that fold away;
- buttons that change with a setting (one panel for several programs, each with its own shortcuts);
- buttons that remember things (a counter, the last tool you picked, a checklist);
- a panel in several languages.

## What to give the assistant

The assistant needs to know how shards work. Give it these files from the LibreShard repository
(attach them, or paste their contents into the chat):

- [`docs/shards.md`](https://github.com/libreshard/libreshard/blob/main/docs/shards.md): the
  complete guide for shard authors (keys, buttons, the rules every shard follows);
- the files of the [shard template](https://github.com/libreshard/libreshard/tree/main/docs/shard-template):
  `manifest.json`, `index.html` and `README.md`, and also `libreshard.css` and `libreshard.js` if
  you want LibreShard's look.

If your assistant can read web pages, the plain-text addresses work too, for example
`https://raw.githubusercontent.com/libreshard/libreshard/main/docs/shards.md`.

Then tell it about your panel:

- **the program** it's for, and its version if shortcuts changed between versions;
- **the keys**: the shortcuts you use and what each one does. Look them up in the program's own
  list of shortcuts rather than letting the assistant guess: assistants often remember shortcuts
  wrong;
- **your system** (Windows, Linux or macOS), because shortcuts differ (Ctrl on Windows is often
  Cmd on a Mac);
- **the device**: a phone or a tablet, held upright or sideways;
- what goes where, which buttons matter most, and the look you'd like.

## A prompt to start with

Copy this, fill in the parts in brackets, and send it together with the files above:

```text
I use LibreShard, which shows panels called "shards" on a tablet and presses keys on my PC.
I attached docs/shards.md (how shards work) and the shard template. Please write a shard for me.

What it's for: [program and version, e.g. "Krita 5.2 for drawing"]
My system: [Windows / Linux / macOS]
My device: [e.g. "a 10-inch Android tablet, held sideways"]
Buttons I want (shortcut and what it does):
- [e.g. "ctrl+z: undo"]
- [e.g. "hold space: pan the canvas"]
- [...]
Layout and look: [e.g. "undo and redo big at the bottom, brush size + and - that repeat while
held, dark colors"]

Follow these rules from docs/shards.md:
- Write manifest.json and index.html (plus CSS or JavaScript files if needed), all in one folder.
- List every key combo the shard presses in permissions.keys, using only the key names from the
  "Keys" section, and nothing it doesn't press.
- Use data-key for a press, data-hold for keys held while the finger is down, and data-repeat for
  keys that repeat while held.
- Nothing from the internet: no CDNs, web fonts, fetch or external images. Everything lives in the
  folder or is embedded.
- Fill the whole screen with relative units (%, vw, vh, grid, flex) and work upright and sideways.
- Keep the top-left corner (about 64 px) free for LibreShard's floating button.
- Make buttons at least 48 px and give them touch-action: none.
- Use Shard.save() and Shard.load() instead of localStorage.
- Set minAppVersion to "0.4.0".
Give me each file complete, ready to save.
```

Save each file the assistant writes with exactly the name it gives (`manifest.json`,
`index.html`…) in one new folder. Plain text editors such as Notepad are fine; make sure the name
doesn't end up as `index.html.txt`.

## Try it while you refine it

1. In LibreShard on the PC, open **Shards → Load in development…** and pick the folder.
2. LibreShard shows the keys the shard asks for (see the next section) and adds it to the tablet's
   menu with an "In development" badge.
3. Open it on the tablet and try every button with the program in front.
4. Tell the assistant what to change ("the undo button is too small", "brush size should repeat
   faster") and save the new files over the old ones. The tablet reloads the shard each time you
   save.

When you're happy with it, install it for good with **Install from folder…** (a development shard
stops working if you move or delete its folder). To share it, use **Export…** on its card, which
saves a `.libreshard` file that opens in LibreShard with a double click.

## Check the keys before you approve them

You don't need to read the code to stay safe. A shard runs in a closed box: it can't reach the
internet, read your files, run programs or see other shards, and it can only press the keys listed
in its `manifest.json`. LibreShard checks every key press against that list on the PC.

So the list of keys is what matters, and LibreShard shows it to you before the shard is installed:

- Read it. Every combo should be one you asked for. If you see keys you didn't ask for, ask the
  assistant why, or remove them.
- **Keys in red** are system shortcuts: the Windows key, Ctrl+Alt combos, Alt+F4 and the like.
  They're fine if you asked for them (Win+Shift+S for a screenshot), but unexpected ones deserve a
  question.
- **The big red warning** appears when a shard has system shortcuts *and* enough keys to type
  text (letters plus Enter). Together they could open the Run box and type a command. Only accept
  it if you know why your panel needs both.

Every time you change `manifest.json`, new keys need your approval again.

## When something doesn't work

- **The shard is blank or looks unstyled:** it probably tries to load something from the internet
  (a font, a library, an image). Ask the assistant to embed it or remove it.
- **A button does nothing:** its combo must be in `permissions.keys`, written with LibreShard's key
  names. The PC window lists shards it rejected, with the reason.
- **It presses the wrong thing:** check the shortcut in the program's own list, and that the
  program is in front on the PC. Symbols follow the PC's keyboard layout.
- **Buttons hide under the round floating button:** remind the assistant to keep the top-left
  corner free.
- **It looks wrong upright or sideways:** say which, and that it must use relative units.

To see errors, open `http://localhost:7878/` in the PC's browser, enter the code from the Connect
tab, open the shard and use the browser's developer tools (F12). Copy any red error into the chat.

## Privacy and ownership

- **Don't paste personal data** into the chat or into the shard: passwords, account names, license
  keys, private file paths. A panel never needs them.
- **The shard is yours.** LibreShard puts no license on what you make; the template and LibreShard's
  base files are MIT-0, so using them adds no obligations. Check your assistant's terms for what
  they say about generated content, and add a `LICENSE` file if you share it.
- **Only include images, icons and logos you may share**, as with any shard you publish (see
  "Sharing your shard" in [docs/shards.md](shards.md#sharing-your-shard)).
