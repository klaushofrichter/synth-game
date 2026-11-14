// What the board and the phone share about the devices and their firmware lists: the devices, each device's catalog
// (assets/emu/firmwares-<device>.json, made by tools/build_game.sh) and the lists' order with the player's stars.

export const DEVICES = [{ id: "fm1", name: "FM-1" }, { id: "smk37", name: "SMK-37" }];
export const deviceName = (d) => DEVICES.find((x) => x.id === d)?.name ?? "FM-1";
/** No stars for any device. */
export const noFavorites = () => Object.fromEntries(DEVICES.map((d) => [d.id, []]));

const catalogs = new Map(); // device -> Promise<{ device, default, firmwares, byId }>

/** A device's catalog, fetched once per page. */
export function loadCatalog(assetUrl, device) {
  if (!catalogs.has(device)) {
    const p = fetch(assetUrl(`emu/firmwares-${device}.json`))
      .then((r) => r.json())
      .then((c) => ({ device, ...c, byId: new Map(c.firmwares.map((f) => [f.id, f])) }));
    p.catch(() => catalogs.delete(device)); // (fetched again next time)
    catalogs.set(device, p);
  }
  return catalogs.get(device);
}

/** The catalog's firmware ids, starred ones first, newest star first, then the catalog's order (E-013). */
export function orderedIds(catalog, stars = []) {
  const first = stars.filter((id) => catalog.byId.has(id));
  const starred = new Set(first);
  return [...first, ...catalog.firmwares.map((f) => f.id).filter((id) => !starred.has(id))];
}
