// The game's emulator build (games/fm1-synth/assets/emu) is what a table runs, committed because a table has no build
// step. These checks fail when it is older than what it is made from, so an emulator change or a catalog refresh
// cannot reach a table without a rebuild (tools/build_game.sh, E-009).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain module, shared with the build script
import { COPIED, EMU, ROOT, catalog, fingerprint } from "../scripts/emu-source.mjs";

const FIX = "run tools/build_game.sh and commit games/fm1-synth/assets/emu with a new game version";

describe("the game's emulator build", () => {
  it("was built from the emulator source as it is now", () => {
    const built = JSON.parse(readFileSync(EMU + "build.json", "utf8")).source;
    expect(built, `the wasm is older than crates/, Cargo.* or web/build.sh: ${FIX}`).toBe(fingerprint());
  });

  it("carries the web page's worklet, package reader and save store as they are", () => {
    for (const f of COPIED as string[]) {
      expect(readFileSync(EMU + f, "utf8"), `${f} differs from web/${f}: ${FIX}`).toBe(readFileSync(`${ROOT}web/${f}`, "utf8"));
    }
  });

  it("lists the page's firmwares, without M-VAVE's own, starting each device on its first firmware", () => {
    for (const d of ["fm1", "smk37"]) {
      const text = readFileSync(`${EMU}firmwares-${d}.json`, "utf8");
      expect(text, `firmwares-${d}.json is out of date: ${FIX}`).toBe(catalog(d));
      const c = JSON.parse(text);
      expect(c.firmwares.some((f: { byo?: boolean }) => f.byo)).toBe(false);
    }
    expect(JSON.parse(readFileSync(`${EMU}firmwares-smk37.json`, "utf8")).default).toBe("erik37");
  });
});
