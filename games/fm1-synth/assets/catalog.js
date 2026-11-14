// What the board and the phone share about the devices and their firmware lists: the devices, each device's catalog
// (assets/emu/firmwares-<device>.json, made by tools/build_game.sh), which of them can be downloaded now, and the
// lists' order with the player's stars.
import { availability, eachLimited } from "./packages.js";

export const DEVICES = [{ id: "fm1", name: "FM-1" }, { id: "smk37", name: "SMK-37" }];
export const deviceName = (d) => DEVICES.find((x) => x.id === d)?.name ?? String(d);
/** No stars for any device. */
export const noFavorites = () => Object.fromEntries(DEVICES.map((d) => [d.id, []]));

const catalogs = new Map(); // device -> Promise<{ device, default, firmwares, byId, gone, checked, check }>
const loaded = new Map(); // device -> the catalog, once it is here

/** A device's catalog, fetched once per page (again after a failure). */
export function loadCatalog(assetUrl, device) {
  if (!catalogs.has(device)) {
    const p = fetch(assetUrl(`emu/firmwares-${device}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`the ${deviceName(device)}'s firmware list could not be loaded (${r.status})`);
        return r.json();
      })
      .then((c) => {
        const cat = { device, ...c, byId: new Map(c.firmwares.map((f) => [f.id, f])) };
        startChecks(cat);
        loaded.set(device, cat);
        return cat;
      });
    p.catch(() => catalogs.delete(device)); // (fetched again next time)
    catalogs.set(device, p);
  }
  return catalogs.get(device);
}

/**
 * Every firmware's package is asked about once per page, in the background, the device's first firmware first (E-016):
 * `cat.check(id)` says how one stands ("ok", "gone", "unknown"), `cat.gone` holds those whose sites say they are gone,
 * and `cat.checked` settles when all are asked. A firmware without an answer (no internet) stays listed.
 */
function startChecks(cat) {
  const answers = new Map(); // id -> Promise<"ok" | "gone" | "unknown">
  const waiting = new Map(); // id -> resolve, until its turn comes
  cat.gone = new Set();
  cat.check = (id) => answers.get(id) ?? Promise.resolve("unknown");
  for (const f of cat.firmwares) answers.set(f.id, new Promise((resolve) => waiting.set(f.id, resolve)));
  const order = [cat.byId.get(cat.default), ...cat.firmwares].filter((f, i, all) => f && all.indexOf(f) === i);
  cat.checked = eachLimited(order, 8, async (f) => {
    const a = await availability(f);
    if (a === "gone") cat.gone.add(f.id);
    waiting.get(f.id)(a);
  });
}

/** A device's catalog if it has been loaded, else undefined (for a tap, which cannot wait). */
export const loadedCatalog = (device) => loaded.get(device);

/** The catalog's firmware ids, starred ones first, newest star first, then the catalog's order (E-013); without those
 * that are gone (E-016). */
export function orderedIds(catalog, stars = []) {
  const first = stars.filter((id) => catalog.byId.has(id));
  const starred = new Set(first);
  return [...first, ...catalog.firmwares.map((f) => f.id).filter((id) => !starred.has(id))].filter((id) => !catalog.gone.has(id));
}
