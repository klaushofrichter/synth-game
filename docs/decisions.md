# Decision log: FM-1 Synth for Game Table

Decisions for the Game Table game in this repository (`games/fm1-synth`), newest last. Platform decisions live in
games-service `docs/decisions.md`. "Klaus" marks product decisions; "Claude" marks implementation choices, which Klaus
can overrule. The emulator itself (crates/, web/) keeps its own history in the README and the commits.

Format: **E-nnn · date · decided by** — decision. *Why:* reason.

Records are history: an older record is not edited when a newer one changes it. Where that happened:

| Earlier | Changed by | What changed |
| --- | --- | --- |
| E-006 | E-011 | The firmware window's device tabs switch the board at once |

- **E-001 · 2026-11-12 · Klaus** — The emulated FM-1 and SMK-37 become one game for Game Table, in this repository's
  `games/` folder (an extra game repository, like extra-games): one player, sitting at the table on South, no AI
  players, no remote player. The board shows only the device's front panel and the platform's own controls (seat
  plate, settings, lobby); the page's other controls become a bar and windows on the board. The board is touch only:
  no keyboard and no external MIDI. *Why:* the emulator as a "game" on the table's screen, with the platform's lobby,
  seats and ready status.
- **E-002 · 2026-11-12 · Claude** — The emulator runs in the board's browser (`board.js`, `assets/synth.js`, the web
  page's own worklet and wasm in `assets/emu/`), and only on the table's own board for the player at the table
  (`info.controlSeats`); a remote board (a watcher) shows a note instead. The rules keep only what the table shares:
  the device, the firmware chosen, how the board says it runs, and the end. *Why:* the machine is far too large and
  fast-changing for game state, and a second emulator on a remote board would play out of step with its own sound.
  Its AudioWorklet needs a secure page, which the table's board at localhost is.
- **E-003 · 2026-11-12 · Claude** — A firmware is chosen by an intent (`firmware`) from the player's phone or the board
  (a board intent); the board reports how it runs (`status`, naming the choice it is about, so a late report about an
  earlier firmware is dropped) and does not report "loading", which the rules set themselves. The phone shows the
  status, the firmware list and **Finish**; it is kept modest (settings like volume may move to it later). *Why:* the
  platform's way for both screens to act on one game, and the status on the phone without a channel of its own. Every
  report counts as a move in the platform's statistics, so there are as few as possible.
- **E-004 · 2026-11-12 · Claude** — Volume and the emulated clock are display choices in the board's settings window
  (`settings()`, `setPrefs`), next to **Choose a firmware…** and **Restart**; the table's sound switch mutes the synth.
  The built files (wasm, worklet, catalogs without M-VAVE's own firmware) are committed in `assets/emu/`, made by
  `tools/build_game.sh`. *Why:* a table gets the game folder as it is, with no build step. No simulation and no
  awards: there is nothing to simulate or to win; the result names the firmwares played and for how long.
- **E-005 · 2026-11-12 · Claude** — The SMK-37's catalog is refreshed from genkigenki's install page
  (`tools/smk37_catalog.mjs`, fixed for the page's new layout: it also lists FM-1 builds now, and its cards changed):
  22 SMK-37 ports, each downloaded, booted and played in the emulator. The game starts the SMK-37 on Erik37 (a grand
  piano written for it); the FM-1 on the page's default (Felucca). *Why:* the old catalog named packages the site had
  replaced (Snoop37 2.6.5 and others: 404), and a piano that is silent until played is a better first sound at a table
  than a groovebox that plays by itself.
- **E-006 · 2026-11-12 · Klaus** — The device can be switched during the game, not only before it: an FM-1 | SMK-37
  tab in the board's firmware window (picking another device's firmware switches the board to it), a **Device** choice
  in the game's part of the board's settings window, and two buttons on the phone. The game setting before the start
  stays, as **Device to start with**. *Why:* the platform locks a game's settings once it runs (a running game's
  settings are fixed for its log and replay), so a switch during the game is the game's own intent (`device`, or
  `firmware` with a `device`), with no platform change. A firmware is known by its device and id together (AMB-1 has
  an FM-1 and an SMK-37 build); the result names each firmware with its device.
- **E-007 · 2026-11-12 · Klaus** — When the board's turn button makes the game face north, the game's parts turn
  180° in place instead of the whole game layer turning: the bar (firmware, status, Restart, Firmware…) stays on the
  north edge with its text facing north, the panel turns within its frame (touches mapped back), and the firmware window
  and a watcher's note turn in place. The seat plate stays on South. *Why:* turning the whole layer put the bar on the
  south edge, over the platform's buttons and beside the seat plate; the game stays one player's, whose plate does not
  move.
- **E-008 · 2026-11-12 · Klaus** — Facing north, the player's seat plate turns in place on South too (it is drawn by
  the game through the board kit's `seatPlates()`). The platform's Lobby button turns only on a remote board turned to a
  north seat (games-service D-157), not on the table's own board; turning it there is asked of games-service as a
  generic change, not done from the game. The settings and turn buttons stay as they are. *Why:* everything the north
  reader uses reads the right way up, while nothing moves; a game does not reach into the platform's page.
- **E-009 · 2026-11-12 · Klaus** — The repository goes public, aligned with the cluster repository's baseline
  (kube-setup `docs/repository-baseline.md`) and with extra-games. It stays a full copy of the emulator that keeps
  merging upstream (joakimeriksson/fm1-emu, MIT, its author credited; upstream's files left as they are), with the game
  in its own folders. Upstream's README becomes `FM1-EMU.md` unchanged and `README.md` describes the game. Upstream's
  four workflows (its Pages site, app and plugin releases, plugin tests, the firmware catalog run) are not carried:
  this repository publishes only the game. *Why:* one place that shows what this repository is for, no second copy of
  upstream's site and releases under another account, and upstream merges that stay simple.
- **E-010 · 2026-11-12 · Claude** — The checks follow extra-games: `test` (game versions, the tests, the typecheck,
  `npm audit --audit-level=high`), `e2e` (a real Table Host, the board and a phone in Chromium, from the lobby to the
  result; it downloads firmwares from their authors' sites, as a table does), and `codeql` (the extra-games gate and
  accepted-findings file), plus `emulator` (upstream's Rust and browser tests, which no other workflow runs here now).
  CodeQL covers this repository's own code (`games/`, `scripts/`, `tests/`, `.github/`); upstream's code is scanned
  upstream. Dependabot covers npm, pip and the actions, not cargo: the emulator's Rust dependencies arrive with
  upstream merges. The committed emulator build carries a fingerprint of the source it was built from
  (`assets/emu/build.json`, `scripts/emu-source.mjs`), and `tests/assets.test.ts` fails when the source, the copied web
  files or the catalogs have moved on. *Why:* rebuilding the wasm in CI and comparing bytes would fail on paths and
  toolchain versions a build embeds; a fingerprint is exact about the source and cheap.
- **E-011 · 2026-11-12 · Klaus** — The FM-1 and SMK-37 tabs in the board's firmware window switch the board to that
  device at once, on its first firmware, as the phone's two buttons do; the window stays open on that device's list to
  pick another, and follows the device when the phone switches it. The tabs are framed in the platform's green
  (`--jade`). Changes E-006, where a tab only showed the other device's list and the board switched when a firmware was
  picked from it. *Why:* on a table the tabs looked broken next to the phone's buttons, which switch at once.
- **E-012 · 2026-11-12 · Klaus** — The game offers the platform's one-seat layout (`seatLayouts: [1]`, games-service
  D-282) instead of the two-seat one: the lobby shows it as a solo game, its single seat at the south, and the player
  count in words ("needs exactly one player"). *Why:* the game is for one player at the board (E-001); a second, empty
  North seat only suggested otherwise. The platform did not offer a one-seat layout before D-282.
