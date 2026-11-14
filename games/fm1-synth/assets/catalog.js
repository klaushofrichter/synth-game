// What the board and the phone share about the devices and their firmware lists: the devices, each device's catalog
// (assets/emu/firmwares-<device>.json, made by tools/build_game.sh) and the lists' order with the player's stars.

export const DEVICES = [{ id: "fm1", name: "FM-1" }, { id: "smk37", name: "SMK-37" }];
export const deviceName = (d) => DEVICES.find((x) => x.id === d)?.name ?? String(d);
/** No stars for any device. */
export const noFavorites = () => Object.fromEntries(DEVICES.map((d) => [d.id, []]));

const catalogs = new Map(); // device -> Promise<{ device, default, firmwares, byId }>
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
        loaded.set(device, cat);
        return cat;
      });
    p.catch(() => catalogs.delete(device)); // (fetched again next time)
    catalogs.set(device, p);
  }
  return catalogs.get(device);
}

/** A device's catalog if it has been loaded, else undefined (for a tap, which cannot wait). */
export const loadedCatalog = (device) => loaded.get(device);

/** The catalog's firmware ids, starred ones first, newest star first, then the catalog's order (E-013). */
export function orderedIds(catalog, stars = []) {
  const first = stars.filter((id) => catalog.byId.has(id));
  const starred = new Set(first);
  return [...first, ...catalog.firmwares.map((f) => f.id).filter((id) => !starred.has(id))];
}
