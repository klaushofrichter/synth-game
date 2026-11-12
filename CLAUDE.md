# Guidance for Claude

This repository is two things: a copy of the emulator [fm1-emu](https://github.com/joakimeriksson/fm1-emu) (upstream,
by Joakim Eriksson: `crates/`, `web/`, `tools/`, `docs/`, … with its README as `FM1-EMU.md`), and the Game Table game
`games/fm1-synth` built on it (E-001, E-009).

## The game

- It follows games-service's developer guide,
  [`docs/developers/game-development.md`](https://github.com/klaushofrichter/games-service/blob/main/docs/developers/game-development.md)
  (also `https://games.skylar.technology/llms.txt`). Read it before changing the game: the platform owns the lobby,
  seats, joining, leaving, away phones and exchanging players; a game only reacts (`onSeatChanged`).
- Record decisions in `docs/decisions.md` (E-nnn) in the same pull request.
- Rules stay deterministic (`ctx.random()`, `ctx.now()`). The emulator runs in the board's browser, never in the rules.
- A change in the game's folder takes a new calendar version:
  `node .games-service/scripts/check-game-versions.ts --base origin/main --fix`.
- After any change to the emulator (`crates/`, `Cargo.*`, `web/build.sh`, `web/worklet.js`, `web/fwsc.js`,
  `web/persistence.js`) or its catalogs (`web/firmwares.json`, `web/smk37/firmwares.json`), run `tools/build_game.sh`
  and commit `games/fm1-synth/assets/emu/`; `tests/assets.test.ts` fails until you do. It needs Rust with the
  `wasm32-unknown-unknown` target.
- Platform changes go to games-service (its session, or Slack #games-application), stay generic, and are avoided
  where the game can do without.

## The emulator (upstream)

- Leave upstream's files as they are, so merges stay simple. Fixes to the emulator belong upstream; mention them to
  Klaus rather than carrying them here.
- Merging upstream: `git fetch upstream && git merge upstream/master` on a branch. Upstream's `README.md` is
  `FM1-EMU.md` here: take upstream's README changes into `FM1-EMU.md` and keep this repository's `README.md`
  (`git show upstream/master:README.md > FM1-EMU.md`, then `git checkout --ours README.md`). Upstream's workflows are
  not carried (`.github/workflows/` holds only `checks.yml`): delete any that a merge brings back. Then rebuild the
  game's emulator, run the tests and the browser check, and give the game a new version.
- `tools/readme_firmwares.mjs` writes upstream's README table into `README.md`; here that table lives in `FM1-EMU.md`,
  so don't run it against this README.
