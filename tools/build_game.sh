#!/usr/bin/env bash
# The Game Table game (games/fm1-synth): the emulator the board runs, copied into the game's assets. A table gets
# the game's folder as it is in the repository (no build step on a table), so the built files are committed:
#   tools/build_game.sh            build the wasm (web/build.sh), copy it, the web files and the catalogs
# Run it after an emulator change or a catalog refresh, and commit games/fm1-synth/assets/emu/ with a new game version
# (node .games-service/scripts/check-game-versions.ts --base origin/main --fix). tests/assets.test.ts fails while the
# committed build is older than its source (E-009).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/games/fm1-synth/assets/emu"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
"$ROOT/web/build.sh" "$TMP/dist" >"$TMP/build.log" 2>&1 || { cat "$TMP/build.log"; exit 1; }
mkdir -p "$OUT"
cp "$TMP/dist/fm1_web.wasm" "$ROOT/web/worklet.js" "$ROOT/web/fwsc.js" "$ROOT/web/persistence.js" "$OUT/"
node "$ROOT/scripts/emu-source.mjs" catalogs
# What the wasm was built from, for the test that keeps it current.
printf '{ "source": "%s" }\n' "$(node "$ROOT/scripts/emu-source.mjs" fingerprint)" > "$OUT/build.json"
ls -la "$OUT" | grep -v "^total"
