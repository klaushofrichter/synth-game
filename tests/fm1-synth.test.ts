// FM-1 Synth's rules on games-service's own runtime: choosing firmwares, the board's status reports, finishing, the
// summary, exact replay, a player exchanged mid-game and the player's starred firmwares (E-013).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGame, replaysExactly, seats, start } from "./harness.ts";

const game = await loadGame("fm1-synth");
const one = (kind: "human" | "ai" = "human") => ({ seats: seats(1, kind) });
/** Let game time pass on the virtual clock. */
const wait = (clock: { setTimeout(fn: () => void, ms: number): unknown; advance(): boolean }, ms: number) => {
  clock.setTimeout(() => {}, ms);
  clock.advance();
};

describe("FM-1 Synth", () => {
  it("starts with no firmware on the device chosen in the settings", () => {
    const { rt } = start(game, 1, { device: "smk37" }, 1, one());
    expect(rt.boardView()).toMatchObject({ device: "smk37", firmware: null, choice: 0, done: false, seat: 0 });
    expect(rt.view(0)).toEqual(rt.boardView());
  });

  it("takes a firmware from the phone or the board, and the board's status for the current choice only", () => {
    const { rt } = start(game, 1, {}, 1, one());
    expect(rt.submit(0, { name: "firmware", payload: { id: "felucca", name: "Felucca" } }, "board")).toEqual({ ok: true });
    expect(rt.boardView()).toMatchObject({ firmware: "felucca", firmwareName: "Felucca", choice: 1, status: { state: "loading" } });
    expect(rt.submit(0, { name: "status", payload: { state: "running", text: "Felucca is running", choice: 1 } }, "board")).toEqual({ ok: true });
    expect(rt.boardView()).toMatchObject({ status: { state: "running", text: "Felucca is running" } });
    expect(rt.submit(0, { name: "firmware", payload: { id: "amb", name: "AMB-1" } }, "human")).toEqual({ ok: true });
    // a late report about Felucca is dropped
    const late = rt.submit(0, { name: "status", payload: { state: "error", text: "x", choice: 1 } }, "board");
    expect(late.ok).toBe(false);
    expect(rt.boardView()).toMatchObject({ firmware: "amb", choice: 2, status: { state: "loading" } });
  });

  it("refuses what it does not know, with words for people", () => {
    const { rt } = start(game, 1, {}, 1, one());
    for (const intent of [
      { name: "firmware", payload: { id: "../etc" } },
      { name: "firmware", payload: {} },
      { name: "status", payload: { state: "exploded", choice: 0 } },
      { name: "dance", payload: null },
    ]) {
      const r = rt.submit(0, intent, "human");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/^[A-Z]/);
    }
  });

  it("ends on Finish with a summary of what was played, and replays exactly", () => {
    const { rt, clock } = start(game, 1, {}, 7, one());
    rt.submit(0, { name: "firmware", payload: { id: "felucca", name: "Felucca" } }, "board");
    wait(clock, 3 * 60_000);
    rt.submit(0, { name: "firmware", payload: { id: "amb", name: "AMB-1" } }, "human");
    wait(clock, 2 * 60_000);
    expect(rt.submit(0, { name: "finish", payload: {} }, "human")).toEqual({ ok: true });
    expect(rt.over).toBe(true);
    const over = game.def.isOver(rt.state) as any;
    expect(over.text).toBe("Ann played Felucca and AMB-1 on the FM-1 for five minutes.");
    expect(over.table.rows[0][0]).toBe("Ann");
    expect(replaysExactly(game, rt)).toBe(true);
  });

  it("switches the device during the game, by itself or with a firmware of the other device", () => {
    const { rt } = start(game, 1, {}, 1, one());
    rt.submit(0, { name: "firmware", payload: { id: "felucca", name: "Felucca" } }, "board");
    expect(rt.submit(0, { name: "device", payload: { device: "smk37" } }, "human")).toEqual({ ok: true });
    // the other device, waiting for the board to name its first firmware
    expect(rt.boardView()).toMatchObject({ device: "smk37", firmware: null, choice: 2, status: { state: "idle" } });
    rt.submit(0, { name: "firmware", payload: { id: "erik37", name: "Erik37", device: "smk37" } }, "board");
    // a firmware of the FM-1 from the picker's other tab switches back at once
    rt.submit(0, { name: "firmware", payload: { id: "amb", name: "AMB-1", device: "fm1" } }, "board");
    expect(rt.boardView()).toMatchObject({ device: "fm1", firmware: "amb", choice: 4 });
    // AMB-1 on the SMK-37 is another firmware than AMB-1 on the FM-1
    rt.submit(0, { name: "firmware", payload: { id: "amb", name: "AMB-1", device: "smk37" } }, "board");
    expect(rt.boardView()).toMatchObject({ device: "smk37", firmware: "amb", choice: 5 });
    for (const bad of [{ device: "tr808" }, {}]) expect(rt.submit(0, { name: "device", payload: bad }, "human").ok).toBe(false);
    expect(rt.submit(0, { name: "firmware", payload: { id: "x", device: "tr808" } }, "human").ok).toBe(false);
    rt.submit(0, { name: "finish", payload: {} }, "human");
    expect((game.def.isOver(rt.state) as any).text).toBe("Ann played Felucca and AMB-1 on the FM-1 and Erik37 and AMB-1 on the SMK-37.");
    expect(replaysExactly(game, rt)).toBe(true);
  });

  it("keeps the new player's name after an exchange", () => {
    const { rt } = start(game, 1, {}, 1, one());
    rt.seatChanged({ seat: 0, playerId: "p9", name: "Zoe", kind: "human", edge: "south" });
    rt.submit(0, { name: "finish", payload: {} }, "human");
    expect((game.def.isOver(rt.state) as any).text).toMatch(/^Zoe played/);
  });

  it("stars firmwares newest first, takes the phone's list once, and forgets it for another player", () => {
    const { rt } = start(game, 1, {}, 1, one());
    const star = (id: string, on: boolean, device = "fm1", by = "board") => rt.submit(0, { name: "star", payload: { device, id, on } }, by as any);
    expect(rt.boardView()).toMatchObject({ favorites: { fm1: [], smk37: [] }, favSynced: false });
    // a star on the board before the phone's list arrived stays in front of it
    expect(star("amb", true)).toEqual({ ok: true });
    expect(rt.submit(0, { name: "favorites", payload: { list: { fm1: ["felucca", "amb", "../x", 7], smk37: ["erik37"], other: ["y"] } } }, "human")).toEqual({ ok: true });
    expect(rt.boardView()).toMatchObject({ favorites: { fm1: ["amb", "felucca"], smk37: ["erik37"] }, favSynced: true });
    // only once: a second list changes nothing
    rt.submit(0, { name: "favorites", payload: { list: { fm1: ["zzz"] } } }, "human");
    expect((rt.boardView() as any).favorites.fm1).toEqual(["amb", "felucca"]);
    // starred again: to the front; unstarred: gone; from the phone too
    star("felucca", true);
    expect((rt.boardView() as any).favorites.fm1).toEqual(["felucca", "amb"]);
    star("amb", false, "fm1", "human");
    star("snoop37", true, "smk37", "human");
    expect((rt.boardView() as any).favorites).toEqual({ fm1: ["felucca"], smk37: ["snoop37", "erik37"] });
    for (const bad of [{ device: "tr808", id: "x", on: true }, { device: "fm1", id: "../x", on: true }]) {
      expect(rt.submit(0, { name: "star", payload: bad }, "board").ok).toBe(false);
    }
    // another person takes the seat: their phone brings their own
    rt.seatChanged({ seat: 0, playerId: "p9", name: "Zoe", kind: "human", edge: "south" });
    expect(rt.boardView()).toMatchObject({ favorites: { fm1: [], smk37: [] }, favSynced: false });
    rt.submit(0, { name: "favorites", payload: { list: { fm1: ["amb"] } } }, "human");
    expect(rt.boardView()).toMatchObject({ favorites: { fm1: ["amb"], smk37: [] }, favSynced: true });
    rt.submit(0, { name: "finish", payload: {} }, "human");
    expect(replaysExactly(game, rt)).toBe(true);
  });
});

describe("the devices", () => {
  it("are the same in the UIs' shared list (assets/catalog.js) as in the manifest's setting", async () => {
    // @ts-expect-error: a plain module of the game's UIs
    const { DEVICES } = await import("../games/fm1-synth/assets/catalog.js");
    const m = JSON.parse(readFileSync(new URL("../games/fm1-synth/manifest.json", import.meta.url), "utf8"));
    const setting = m.settings.find((s: { key: string }) => s.key === "device");
    expect(DEVICES.map((d: { id: string }) => d.id)).toEqual(setting.values);
    expect(DEVICES.map((d: { name: string }) => d.name)).toEqual(setting.values.map((v: string) => setting.labels[v]));
  });
});

describe("firmwares whose packages are gone (E-016)", () => {
  // A made-up web: what each URL answers; a URL not listed gets no answer (as without internet).
  const web: Record<string, number | object> = {
    "https://a.test/here.fwsc": 200,
    "https://a.test/old.fwsc": 404,
    "https://a.test/gone.fwsc": 404,
    "https://thefirmwarehub.com/catalog.json": { firmwares: [{ id: "moved", pkg: "fw/moved-2.fwsc" }] },
    "https://thefirmwarehub.com/fw/moved-2.fwsc": 200,
  };
  const asked: string[] = [];
  const fakeFetch = async (url: string, init?: { method?: string }) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    const a = web[url];
    if (a === undefined) throw new TypeError("Failed to fetch");
    return typeof a === "number"
      ? new Response(null, { status: a })
      : new Response(JSON.stringify(a), { status: 200, headers: { "content-type": "application/json" } });
  };

  it("are told apart from those that are there, or moved on the Hub, or get no answer, with HEAD for packages", async () => {
    // @ts-expect-error: a plain module of the game's UIs
    const { availability } = await import("../games/fm1-synth/assets/packages.js");
    const real = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      expect(await availability({ id: "a", package: "https://a.test/here.fwsc" })).toBe("ok");
      expect(await availability({ id: "b", package: "https://a.test/old.fwsc", hub: "moved" })).toBe("ok");
      expect(await availability({ id: "c", package: "https://a.test/gone.fwsc", hub: "nothere" })).toBe("gone");
      expect(await availability({ id: "d", package: "https://b.test/x.fwsc" })).toBe("unknown");
    } finally {
      globalThis.fetch = real;
    }
    expect(asked.filter((a) => a.endsWith(".fwsc")).every((a) => a.startsWith("HEAD "))).toBe(true);
  });

  it("include one whose site gives no answer while others do, but none when nothing answers", async () => {
    // @ts-expect-error: a plain module of the game's UIs
    const { loadCatalog } = await import("../games/fm1-synth/assets/catalog.js");
    const lists: Record<string, object> = {
      "/emu/firmwares-fm1.json": { default: "a", firmwares: [{ id: "a", package: "https://a.test/here.fwsc" }, { id: "x", package: "https://b.test/x.fwsc" }] },
      "/emu/firmwares-smk37.json": { default: "y", firmwares: [{ id: "y", package: "https://b.test/y.fwsc" }] },
    };
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { method?: string }) =>
      lists[url] ? new Response(JSON.stringify(lists[url])) : fakeFetch(url, init)) as typeof fetch;
    try {
      const fm1 = await loadCatalog((p: string) => `/${p}`, "fm1");
      await fm1.checked;
      expect([...fm1.gone]).toEqual(["x"]);
      const smk = await loadCatalog((p: string) => `/${p}`, "smk37");
      await smk.checked;
      expect([...smk.gone]).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("are left out of the lists, also when starred", async () => {
    // @ts-expect-error: a plain module of the game's UIs
    const { orderedIds } = await import("../games/fm1-synth/assets/catalog.js");
    const firmwares = ["a", "b", "c"].map((id) => ({ id }));
    const catalog = { firmwares, byId: new Map(firmwares.map((f) => [f.id, f])), gone: new Set(["b"]) };
    expect(orderedIds(catalog, ["b", "c"])).toEqual(["c", "a"]);
  });
});

describe("the rules' edges", () => {
  it("cleans what the board and the phone send: control characters out, long words cut", () => {
    const { rt } = start(game, 1, {}, 1, one());
    rt.submit(0, { name: "firmware", payload: { id: "a", name: "Al\u0007pha" + "x".repeat(200) } }, "board");
    expect((rt.boardView() as any).firmwareName).toBe("Al pha" + "x".repeat(74));
    rt.submit(0, { name: "status", payload: { state: "running", text: "ok\n" + "y".repeat(300), choice: 1 } }, "board");
    expect((rt.boardView() as any).status.text).toHaveLength(160);
    expect((rt.boardView() as any).status.text.startsWith("ok y")).toBe(true);
    // a firmware without a name goes by its id
    rt.submit(0, { name: "firmware", payload: { id: "b" } }, "board");
    expect(rt.boardView()).toMatchObject({ firmwareName: "b", status: { text: "Loading b…" } });
  });

  it("changes nothing for the same firmware, the same device or the same status again", () => {
    const { rt } = start(game, 1, {}, 1, one());
    rt.submit(0, { name: "firmware", payload: { id: "a", name: "A" } }, "board");
    const before = rt.boardView();
    expect(rt.submit(0, { name: "firmware", payload: { id: "a", name: "A" } }, "human")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "device", payload: { device: "fm1" } }, "human")).toEqual({ ok: true });
    expect(rt.boardView()).toEqual(before);
    rt.submit(0, { name: "status", payload: { state: "running", text: "A runs", choice: 1 } }, "board");
    const running = rt.boardView();
    rt.submit(0, { name: "status", payload: { state: "running", text: "A runs", choice: 1 } }, "board");
    expect(rt.boardView()).toEqual(running);
    // played once, however often chosen
    rt.submit(0, { name: "firmware", payload: { id: "b", name: "B" } }, "board");
    rt.submit(0, { name: "firmware", payload: { id: "a", name: "A" } }, "board");
    rt.submit(0, { name: "finish", payload: {} }, "human");
    expect((game.def.isOver(rt.state) as any).highlights.firmwares).toEqual(["fm1/a", "fm1/b"]);
  });

  it("refuses everything once the session is over", () => {
    const { rt } = start(game, 1, {}, 1, one());
    rt.submit(0, { name: "finish", payload: {} }, "human");
    for (const intent of [
      { name: "firmware", payload: { id: "a" } },
      { name: "star", payload: { device: "fm1", id: "a", on: true } },
      { name: "finish", payload: {} },
    ]) {
      const r = rt.submit(0, intent, "human");
      expect(r.ok).toBe(false);
    }
  });

  it("sums up a session where nothing was played, and short ones without minutes", () => {
    const { rt } = start(game, 1, { device: "smk37" }, 1, one());
    rt.submit(0, { name: "finish", payload: {} }, "human");
    const over = game.def.isOver(rt.state) as any;
    expect(over.text).toBe("Ann played the SMK-37.");
    expect(over.highlights).toEqual({ devices: [], firmwares: [], minutes: 0 });
    expect(over.table).toEqual({ columns: ["Player", "Firmwares", "Minutes"], rows: [["Ann", 0, 0]] });
  });

  it("keeps at most 200 stars per device, the newest", () => {
    const { rt } = start(game, 1, {}, 1, one());
    const many = Array.from({ length: 250 }, (_, i) => `f${i}`);
    rt.submit(0, { name: "favorites", payload: { list: { fm1: many } } }, "human");
    expect((rt.boardView() as any).favorites.fm1).toEqual(many.slice(0, 200));
    rt.submit(0, { name: "star", payload: { device: "fm1", id: "new", on: true } }, "board");
    const fm1 = (rt.boardView() as any).favorites.fm1;
    expect(fm1).toHaveLength(200);
    expect(fm1[0]).toBe("new");
    expect(fm1.at(-1)).toBe("f198");
    // a star off for one not starred changes nothing
    expect(rt.submit(0, { name: "star", payload: { device: "smk37", id: "x", on: false } }, "board")).toEqual({ ok: true });
  });

  it("describes each step for the statistics in words", () => {
    const d = game.def.describe!;
    const step = (name: string, payload: object, accepted = true, after: object = {}) =>
      d({ kind: "intent", intent: { name, payload }, accepted, after: { device: "fm1", firmwareName: "Alpha", status: { state: "running", text: "" }, ...after } } as any);
    expect(step("firmware", { id: "a" })).toEqual({ text: "picks Alpha" });
    expect(step("firmware", { id: "a" }, false)).toEqual({ text: "tries to pick a firmware" });
    expect(step("device", { device: "smk37" }, true, { device: "smk37" })).toEqual({ text: "switches to the SMK-37" });
    expect(step("status", {}, true, { status: { state: "error", text: "" } })).toEqual({ text: "board: error" });
    expect(step("status", {}, true, { status: { state: "running", text: "Alpha runs" } })).toEqual({ text: "board: Alpha runs" });
    expect(step("star", { id: "a", on: true })).toEqual({ text: "stars a" });
    expect(step("star", { id: "a", on: false })).toEqual({ text: "unstars a" });
    expect(step("finish", {})).toEqual({ text: "is done playing" });
    expect(step("favorites", {})).toBe(null);
    expect(d({ kind: "timer" } as any)).toBe(null);
  });
});

describe("the shared catalog module", () => {
  const LIST = { default: "b", firmwares: [{ id: "a", package: "https://c.test/a.fwsc" }, { id: "b", package: "https://c.test/b.fwsc" }] };

  it("loads a device's list once per page, again after a failure, and asks about its first firmware first", async () => {
    const mod = "../games/fm1-synth/assets/catalog.js?once"; // (its own copy: an earlier test loaded the FM-1's list)
    const { loadCatalog, loadedCatalog, deviceName, noFavorites } = await import(mod);
    const asked: string[] = [];
    let fail = true;
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith(".json")) return fail ? new Response("", { status: 503 }) : new Response(JSON.stringify(LIST));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      await expect(loadCatalog((p: string) => `/${p}`, "fm1")).rejects.toThrow("the FM-1's firmware list could not be loaded (503)");
      expect(loadedCatalog("fm1")).toBe(undefined);
      fail = false;
      const c = await loadCatalog((p: string) => `/${p}`, "fm1");
      expect(await loadCatalog((p: string) => `/${p}`, "fm1")).toBe(c);
      expect(loadedCatalog("fm1")).toBe(c);
      expect(asked.filter((a) => a.endsWith(".json"))).toHaveLength(2);
      await c.checked;
      expect(asked.filter((a) => a.endsWith(".fwsc"))).toEqual(["HEAD https://c.test/b.fwsc", "HEAD https://c.test/a.fwsc"]);
      expect(await c.check("a")).toBe("ok");
      expect(await c.check("nope")).toBe("unknown");
    } finally {
      globalThis.fetch = real;
    }
    expect(deviceName("smk37")).toBe("SMK-37");
    expect(deviceName("tr808")).toBe("tr808");
    expect(noFavorites()).toEqual({ fm1: [], smk37: [] });
  });
});

describe("asking about a package", () => {
  it("tries the first byte where a site refuses HEAD, and takes 410 as gone", async () => {
    // @ts-expect-error: a plain module of the game's UIs
    const { availability, eachLimited } = await import("../games/fm1-synth/assets/packages.js");
    const asked: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      asked.push(`${init?.method ?? "GET"}${init?.headers?.Range ? " range" : ""} ${url}`);
      if (url.includes("nohead")) return new Response(init?.method === "HEAD" ? null : "x", { status: init?.method === "HEAD" ? 405 : 206 });
      if (url.includes("removed")) return new Response(null, { status: 410 });
      if (url.includes("install")) return new Response(null, { status: init?.method === "HEAD" ? 200 : 500 });
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    try {
      expect(await availability({ id: "n", package: "https://d.test/nohead.fwsc" })).toBe("ok");
      expect(asked).toEqual(["HEAD https://d.test/nohead.fwsc", "GET range https://d.test/nohead.fwsc"]);
      expect(await availability({ id: "r", package: "https://d.test/removed.fwsc" })).toBe("gone");
      // a package inside its install page: only the page is asked about, not downloaded
      asked.length = 0;
      expect(await availability({ id: "e", embedded: "FW", installer: "https://d.test/install/" })).toBe("ok");
      expect(asked).toEqual(["HEAD https://d.test/install/"]);
      expect(await availability({ id: "e", embedded: "FW", installer: "https://d.test/gone/" })).toBe("gone");
    } finally {
      globalThis.fetch = real;
    }
    // at most n at a time, every item once
    let running = 0, most = 0;
    const done: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (i: number) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      done.push(i);
    });
    expect(most).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
