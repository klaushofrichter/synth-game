// What the game's emulator build (games/fm1-synth/assets/emu, by tools/build_game.sh) is made from, so the tests can
// tell when it is out of date (E-009): a fingerprint of the Rust source and build settings the wasm is compiled from,
// the web files copied as they are, and the catalogs the game reads, made from the web page's.
//   node scripts/emu-source.mjs fingerprint     the fingerprint of the source as it is now
//   node scripts/emu-source.mjs catalogs        write the game's catalogs (the build script runs it)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const EMU = `${ROOT}games/fm1-synth/assets/emu/`;
/** Files copied from web/ as they are. */
export const COPIED = ["worklet.js", "fwsc.js", "persistence.js"];
/** What the wasm is compiled from: every tracked file under these paths. */
const SOURCES = ["crates", "Cargo.toml", "Cargo.lock", "web/build.sh"];

/** sha256 over the path and contents of every tracked source file, as they are in the working tree. */
export function fingerprint() {
  const files = execFileSync("git", ["ls-files", "-z", "--", ...SOURCES], { cwd: ROOT }).toString().split("\0").filter(Boolean).sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f + "\0");
    h.update(readFileSync(ROOT + f));
    h.update("\0");
  }
  return h.digest("hex");
}

// The first firmware per device: on the SMK-37 Erik37, a grand piano written for it (silent until played, a better
// start at a table than a groovebox that plays by itself; E-005); on the FM-1 the page's own default.
const DEFAULTS = { smk37: "erik37" };
const KEEP = ["id", "name", "version", "author", "about", "license", "repo", "hub", "package", "installer", "manifest", "embedded"];
const SOURCE_CATALOG = { fm1: "web/firmwares.json", smk37: "web/smk37/firmwares.json" };

/** The game's catalog for a device: the page's, without M-VAVE's own firmware (no file picker on a table), only the
 * fields the game reads. As JSON text. */
export function catalog(device) {
  const c = JSON.parse(readFileSync(ROOT + SOURCE_CATALOG[device], "utf8"));
  const def = DEFAULTS[device] ?? c.default;
  const firmwares = c.firmwares.filter((f) => !f.byo).map((f) => Object.fromEntries(KEEP.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])));
  if (!firmwares.some((f) => f.id === def)) throw new Error(`${SOURCE_CATALOG[device]}: the default ${def} is not in the catalog`);
  return JSON.stringify({ default: def, firmwares }) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "fingerprint") console.log(fingerprint());
  else if (cmd === "catalogs") {
    for (const d of Object.keys(SOURCE_CATALOG)) {
      const text = catalog(d);
      writeFileSync(`${EMU}firmwares-${d}.json`, text);
      console.log(`firmwares-${d}.json: ${JSON.parse(text).firmwares.length} firmwares`);
    }
  } else {
    console.error("usage: node scripts/emu-source.mjs fingerprint | catalogs");
    process.exit(2);
  }
}
