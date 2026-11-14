// Which listed firmwares a table leaves out because their packages are gone, asked as the board and the phone ask
// (games/fm1-synth/assets/packages.js: upstream's download with its fallbacks, HEAD only). Authors replace and remove
// packages without notice; the game passes over them by itself (E-016), so this only says which ones, as a warning on
// the checks: a catalog refresh (tools/smk37_catalog.mjs or tools/hub_catalog.mjs, then tools/build_game.sh) may bring
// a newer package.
//   node scripts/check-packages.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { availability, eachLimited } from "../games/fm1-synth/assets/packages.js";

const EMU = fileURLToPath(new URL("../games/fm1-synth/assets/emu/", import.meta.url));

const notes = [];
for (const device of ["fm1", "smk37"]) {
  const { firmwares } = JSON.parse(readFileSync(`${EMU}firmwares-${device}.json`, "utf8"));
  const answers = new Map();
  await eachLimited(firmwares, 8, async (f) => answers.set(f, await availability(f)));
  const off = firmwares.filter((f) => answers.get(f) !== "ok");
  console.log(`${device}: ${firmwares.length - off.length} of ${firmwares.length} firmwares can be downloaded`);
  for (const f of off) {
    notes.push(`${device}/${f.id} (${f.name}): ${answers.get(f) === "gone" ? "gone, left out on the tables" : "no answer from its site"}`);
  }
}
for (const n of notes) console.log(process.env.GITHUB_ACTIONS ? `::warning title=Firmware package::${n}` : `  ${n}`);
