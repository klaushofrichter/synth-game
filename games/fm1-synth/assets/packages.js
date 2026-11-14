// Whether a firmware's package can be downloaded now, asked the way a table downloads it (upstream's fetchPackage
// with its fallbacks: the Firmware Hub's newer package, the author's install page), but with a HEAD request for each
// package, so nothing large is downloaded. The board and the phone ask for every listed firmware and leave out those
// that are gone; scripts/check-packages.mjs reports them (E-016).
import { fetchPackage } from "./emu/fwsc.js";

class NoAnswer extends Error {}

/** fetch for fetchPackage: a package (.fwsc) is only asked about (HEAD; the first byte where a site refuses HEAD),
 * anything else is fetched. A request that gets no answer at all throws NoAnswer. One function for every check, so
 * upstream fetches the Hub's catalog once (it keeps it per fetch function). */
async function probe(url, init) {
  try {
    if (!/\.fwsc$/i.test(new URL(url).pathname)) return await fetch(url, init);
    let r = await fetch(url, { method: "HEAD" });
    if (!r.ok && r.status !== 404 && r.status !== 410) {
      r = await fetch(url, { headers: { Range: "bytes=0-0" } });
      await r.body?.cancel();
    }
    return { ok: r.ok, status: r.status, arrayBuffer: async () => new ArrayBuffer(0) };
  } catch {
    throw new NoAnswer(url);
  }
}

/**
 * "ok", "gone" (its site says the package is not there, and no fallback has it), or "unknown" (no answer: no internet
 * at the table, a site down).
 */
export async function availability(entry) {
  try {
    if (entry.embedded) {
      // (the package is inside its install page: only that page is asked about)
      const r = await probe(entry.installer, { method: "HEAD" });
      return r.ok ? "ok" : "gone";
    }
    await fetchPackage(entry, probe);
    return "ok";
  } catch (e) {
    return e instanceof NoAnswer ? "unknown" : "gone";
  }
}

/** fn over the items, at most n at a time, in the items' order. */
export async function eachLimited(items, n, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
