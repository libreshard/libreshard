# Translations

One JSON file per language, keyed like `en.json`. A text missing from a language shows in English.

| File | Language | Written by |
|---|---|---|
| `en.json` | English | the maintainer (the reference) |
| `es.json` | Spanish | the maintainer |
| `fr.json` | French | AI, not reviewed by a person yet |
| `pt.json` | Brazilian Portuguese (Portugal falls back to it too) | AI, not reviewed by a person yet |

The languages translated by AI are listed in `MACHINE` (`index.js`): the PC window says so next to
the language setting, with a **Suggest a fix** button that opens the
[translation form](https://github.com/libreshard/libreshard/issues/new?template=translation.yml).
A language leaves that list once a native speaker has reviewed all of it.

## Changing a text

- **A fix:** edit the language's file in a pull request, or use the form above if you'd rather not.
- **A new text in the app:** add it to `en.json` and `es.json` in the same pull request (the tests
  require both). French and Portuguese can wait: the tests list what's missing as a warning, and
  it's completed before each release.
- **A new language:** a new file, its entry in `index.js` (and in `MACHINE` if it's machine
  translated), and `settings.language.<code>` (its name, in that language) in every file.

`npm test` checks that every language uses exactly the same `{placeholders}` as English, has no
keys English doesn't, and has no empty texts; it warns about missing texts and texts more than 1.5
times as long as the English one, which may not fit.

## Rules

- Keep every `{placeholder}` as it is, and `\n` line breaks where the English has them.
- Plain text only: no HTML, no Markdown.
- Keep it about as short as the English: buttons and labels have little room, especially on a phone.
- Talk to the user directly and politely: *vous* in French, *você* in Portuguese. Imperative for
  actions ("Install", not "Installing").
- Sentence case in buttons and titles, as in English ("Install from folder…").
- Keep the ellipsis (…) of menu items that open a dialog.
- Quotes: French uses « » with a non-breaking space inside; Portuguese uses “ ”.
- French typography: a non-breaking space (U+00A0) before `:`, `;`, `?` and `!`.

## Glossary

Never translated: **LibreShard**, **shard** (masculine: *le shard*, *o shard*), **Stream Deck**,
**Tailscale**, **QR**, **IP**, **VPN**, **OLED**, program names, and `.libreshard`, `.zip`.

| English | French | Portuguese (Brazil) | Notes |
|---|---|---|---|
| tablet | tablette | tablet | also means phones |
| this PC / This PC (the panel on the PC's screen) | ce PC / Ce PC | este PC / Este PC | |
| device | appareil | dispositivo | |
| pair / unpair | associer / dissocier | parear / desparear | a paired device |
| pairing code | code d'association | código de pareamento | |
| key (keyboard) | touche | tecla | never *clé* / *chave* |
| combination (of keys) | combinaison | combinação | |
| shortcut | raccourci | atalho | |
| press / hold / repeat | appuyer / maintenir / répéter | pressionar / segurar / repetir | |
| tap (on the tablet) | toucher | tocar | |
| app (a program) | application | app | |
| in the foreground / in front | au premier plan | em primeiro plano | |
| permissions | autorisations | permissões | the keys a shard may press |
| review (the install review) | vérification | revisão | |
| approve | approuver | aprovar | |
| install / uninstall | installer / désinstaller | instalar / desinstalar | |
| update (a shard) | mettre à jour | atualizar | |
| bundled | inclus | incluído | shards that come with the app |
| gallery | galerie | galeria | |
| editor / shard editor | éditeur / éditeur de shards | editor / editor de shards | |
| page / grid / cell | page / grille / case | página / grade / célula | in the editor |
| look (of a button) | apparence | aparência | |
| theme | thème | tema | |
| settings (a shard's) | réglages | configurações | |
| Settings (the tab) | Réglages | Configurações | |
| backup | sauvegarde | backup | |
| export / import | exporter / importer | exportar / importar | |
| favorite | favori | favorito | |
| menu (the tablet's shard list) | menu | menu | |
| floating button | bouton flottant | botão flutuante | |
| Load in development | Charger en développement | Carregar em desenvolvimento | |
| tray | zone de notification | bandeja do sistema | |
| full screen | plein écran | tela cheia | |
| Shift / Ctrl / Alt / Windows key | Maj / Ctrl / Alt / touche Windows | Shift / Ctrl / Alt / tecla Windows | |
| numeric keypad | pavé numérique | teclado numérico | |
| push to talk | appuyer pour parler | apertar para falar | |
