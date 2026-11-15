# Selling your shard

A shard is your work, and you can sell it. This guide covers what LibreShard does and doesn't do
for paid shards, a license you can start from, how buyers install it, and how to list it in the
gallery.

- [What LibreShard does, and what it doesn't](#what-libreshard-does-and-what-it-doesnt)
- [Before you sell](#before-you-sell)
- [A license for a paid shard](#a-license-for-a-paid-shard)
- [Package it](#package-it)
- [Where to sell it](#where-to-sell-it)
- [What sells](#what-sells)
- [List it in the gallery](#list-it-in-the-gallery)
- [New versions](#new-versions)

## What LibreShard does, and what it doesn't

- **There's no copy protection, on purpose.** The tablet has to receive a shard's HTML, CSS and
  JavaScript as they are to show it, and the files sit on the buyer's PC. Any encryption would be
  undone right before showing it, and LibreShard is open source, so a check could be removed with
  one line. What protects your work is your **license** (personal use, no sharing) and asking for
  shared copies to be taken down, as with fonts, templates and icon packs.
- **Minifying is up to you.** It doesn't change the install review or the safety of the shard:
  LibreShard only presses the keys the shard declares and the user approves, and a shard can't reach
  the network. Tools that rely on `eval` or `new Function` won't work (the shard's Content Security
  Policy blocks them).
- **Buyers see the same review as for any shard:** every key, the apps, the size, and your license
  and page from the manifest.
- **LibreShard takes no cut** and doesn't handle payments: you sell wherever you like.

## Before you sell

- **Use only material you may sell.** Images, icons, fonts and sounds need a license that allows
  commercial use and redistribution. Game fan kits often allow personal or non-commercial use only.
- **Games and programs have their own rules.** Read the fan content or trademark policy of the game
  or program your shard is for before selling something with its name or look. Drawing your own
  icons, as the [SC MFD](https://github.com/libreshard/libreshard-sc-mfd) does, avoids most problems.
- **Name it clearly.** "MFD for LibreShard" is fine; nothing that suggests it's official or made by
  LibreShard (see [TRADEMARKS.md](../TRADEMARKS.md)).
- **The template and LibreShard's base files are MIT-0:** you can use them in a closed, paid shard,
  with no notice required.

## A license for a paid shard

Put it in a `LICENSE` file in the shard's folder, and set the manifest's `license` to
`"LicenseRef-Proprietary"` (or your own `LicenseRef-…` name), so the install review shows it. A
starting point (not legal advice: adapt it, or ask a lawyer):

```text
<Shard name>
Copyright (c) <year> <your name>. All rights reserved.

You may install this shard and use it on your own devices, for personal or work use, and change it
for your own use.

You may not share, publish, sell or give away this shard or a changed version of it, in whole or
in part, without written permission from the author. Buying it gives you a license to use it, not
ownership of it.

This shard is provided "as is", without warranty of any kind. The author isn't liable for any damage
arising from its use.
```

## Package it

- Set `version`, `license`, `url` (your shop or page) and `minAppVersion` in `manifest.json`.
- Use **Export…** on the shard's card in the Shards tab: it saves a `.libreshard` file without
  hidden files (`.git`, `.DS_Store`). That file is what you sell.
- Buyers open it with a double click (or drop it on the LibreShard window). If your shop gives them
  a direct `https://` download address, a `libreshard://install?url=…` link installs it in one click
  (see [Sharing your shard](shards.md#sharing-your-shard)).

## Where to sell it

Any shop for digital files works. Some act as the **merchant of record** (they handle sales tax and
VAT for you, worldwide), which saves a lot of paperwork; others leave that to you. Check each one's
current terms and fees:

- [itch.io](https://itch.io): popular with players, supports "pay what you want" and free downloads.
- [Gumroad](https://gumroad.com) and [Lemon Squeezy](https://www.lemonsqueezy.com): simple
  storefronts that present themselves as merchants of record.
- [Ko-fi](https://ko-fi.com) shop: handy if you already take donations there.

Wherever you sell, mention that buyers need LibreShard (free, [libreshard.com](https://libreshard.com))
and which version.

## What sells

What people pay for is your work and your care, more than the files:

- a free version, and a paid one with more pages or programs;
- updates when the game or program changes its shortcuts;
- early access: paid first, free later;
- "pay what you want", with a suggested price;
- shards made to order.

## List it in the gallery

Paid shards can be listed in the [gallery](https://libreshard.com/gallery/), with a "Paid" label and
a "Buy" button that opens your shop. LibreShard never downloads a paid shard by itself.

- Add an entry to [libreshard/shards](https://github.com/libreshard/shards#publish-your-shard) with
  `"paid": true`, `"price"` (text: `"4 USD"`, `"Pay what you want"`) and `"buyUrl"` instead of
  `"download"`. `keys` must still be exactly the manifest's, so people see them before buying.
- Give the reviewer a copy (a private link is fine). The code may be minified; the manifest may not.
- A free demo can have its own entry.
- Paying gives no better place in the gallery. See the [review policy](https://github.com/libreshard/shards/blob/main/POLICY.md).

## New versions

- Keep the same `id` and `author`, and raise `version`.
- Update the gallery entry's `version` (and `keys`, if they changed) with a pull request. Buyers who
  have your shard then see "Version x available" on its card, with a button to your shop, even if
  they installed it from your file.
- When they install the new file, LibreShard shows what changed, new keys first.
