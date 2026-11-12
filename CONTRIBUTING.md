# Contributing to LibreShard

Thanks for helping! Bug reports, shards, translations, documentation and code are all welcome.

## Ways to help

- **Report a bug:** in LibreShard, **Settings → Report a bug** opens the issue form with your version
  and system filled in, and copies the diagnostics for you to paste (read them first). You can also
  [open an issue](https://github.com/libreshard/libreshard/issues/new/choose) yourself with your
  LibreShard version, your OS (and desktop on Linux), what you did and what happened.
  For security problems, follow [SECURITY.md](SECURITY.md) instead.
- **Share a shard:** you don't need to change LibreShard for that. Publish your shard in your own
  repository (see [docs/shards.md](docs/shards.md)) and tell us about it in an issue or discussion.
- **Propose a bundled shard:** open an issue first. Bundled shards must work with the declarative
  `data-key` / `data-hold` attributes, ship English and Spanish texts, and use no third-party
  material (logos, images, fonts).
- **Translate:** UI texts live in `i18n/en.json` and `i18n/es.json`. A new language is a new file
  with the same keys.

## Setting up

You need [Node.js](https://nodejs.org/) 22 or newer and Git. On Linux, an X11 session and
`libxtst6`, `x11-utils` and `x11-xserver-utils`.

```bash
git clone https://github.com/libreshard/libreshard.git
cd libreshard
npm install
npm start          # the app, with its server on port 7878
npm test           # the test suite (node:test, no extra tools)
npm run test:linux # real key injection under Xvfb, needs Docker
```

To try it without a tablet, click the **This PC** card in the app window.

[CONTEXT.md](CONTEXT.md) explains the architecture, every file, the protocol and the security
model. Please read its sections 6 (security model) and 11 (conventions) before changing code.

## Conventions

- Plain JavaScript (CommonJS in the app, no framework in the viewer), no bundler, no transpiling.
- Few dependencies: justify any new one in the pull request.
- Code comments and docs in English. Every UI text goes through `i18n/` in both languages.
- New server behavior needs tests. Run `npm test` before opening a pull request, and
  `npm run test:linux` if you touched keys, app detection or anything platform-specific.
- A change to the protocol, the manifest format or the shard rules must update CONTEXT.md §4–5.
- Never weaken the security model in CONTEXT.md §6.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, and describe what it changes and how you tested it.
3. Sign off every commit (see below).
4. CI runs the tests on Windows, Linux and macOS. macOS is experimental, so its failures don't
   block a merge.

## Licensing of contributions and the DCO

LibreShard is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms (as section 5 of the license says). The files in
`shard-base/` and `docs/shard-template/` are under [MIT-0](LICENSES/MIT-0.txt), and so are
contributions to them.

We also use the [Developer Certificate of Origin](https://developercertificate.org/) (DCO): a
statement that you wrote the change or otherwise have the right to submit it under the project's
license. You make it by adding a `Signed-off-by` line to each commit, with a name and email that
identify you:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Git adds it for you with `git commit -s`. If you forgot, `git commit --amend -s` fixes the last
commit, and `git rebase --signoff main` fixes every commit in your branch.

There's no contributor license agreement (CLA) to sign.

<details>
<summary>Developer Certificate of Origin 1.1</summary>

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

</details>

## Code of conduct

Everyone taking part in the project follows the **[code of conduct](CODE_OF_CONDUCT.md)**
(Contributor Covenant 3.0). In short: be kind and assume good faith; harassment or personal attacks
aren't tolerated. To report a problem, write to conduct@libreshard.com.
