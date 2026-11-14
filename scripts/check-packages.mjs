// Every firmware the game lists can be downloaded, as a table downloads it: from its package URL, or, for a package
// the Firmware Hub has replaced, from the package the Hub lists now (upstream's fallback in web/fwsc.js). Authors
// replace packages without notice (E-015); this says which ones went, before a table finds out.
//   node scripts/check-packages.mjs            say which cannot be downloaded (a warning on a pull request's checks)
//   node scripts/check-packages.mjs --strict   and exit 1 then (the weekly run: a site's change is not a PR's fault)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EMU = fileURLToPath(new URL("../games/fm1-synth/assets/emu/", import.meta.url));
const HUB = "https://thefirmwarehub.com/";

/** The URL answers with something (a HEAD where the site allows it, else the first byte). */
async function reachable(url) {
  for (const init of [{ method: "HEAD" }, { headers: { Range: "bytes=0-0" } }]) {
    try {
      const r = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(20000) });
      await r.body?.cancel();
      if (r.ok) return true;
      if (r.status === 404 || r.status === 410) return false;
    } catch {}
  }
  return false;
}

let hub;
async function hubPackage(id) {
  hub ??= fetch(HUB + "catalog.json").then((r) => r.json()).catch(() => ({ firmwares: [] }));
  const h = (await hub).firmwares?.find((x) => x.id === id);
  return h?.pkg ? new URL(h.pkg, HUB).href : null;
}

const missing = [];
for (const device of ["fm1", "smk37"]) {
  const { firmwares } = JSON.parse(readFileSync(`${EMU}firmwares-${device}.json`, "utf8"));
  const results = await Promise.all(
    firmwares.map(async (f) => {
      if (!f.package || (await reachable(f.package))) return null;
      const now = f.hub && (await hubPackage(f.hub));
      if (now && (await reachable(now))) return null;
      return `${device}/${f.id} (${f.name}): ${f.package}${f.hub ? `, and the Hub lists ${now ?? "nothing"} for ${f.hub}` : ""}`;
    }),
  );
  const gone = results.filter(Boolean);
  console.log(`${device}: ${firmwares.length - gone.length} of ${firmwares.length} firmwares can be downloaded`);
  missing.push(...gone);
}
if (missing.length) {
  const fix = "refresh the catalog (tools/smk37_catalog.mjs or tools/hub_catalog.mjs, then tools/build_game.sh)";
  console.error(`Cannot be downloaded; ${fix}:\n  ${missing.join("\n  ")}`);
  if (process.env.GITHUB_ACTIONS) for (const m of missing) console.log(`::warning title=Firmware package gone::${m}; ${fix}`);
  if (process.argv.includes("--strict")) process.exit(1);
}
