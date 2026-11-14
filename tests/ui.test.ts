// FM-1 Synth's board and phone, in a browser-like page (happy-dom), on the game's real rules (games-service's runtime)
// and the platform's board kit, with a made-up web: two small catalogs, packages that are there or gone, and a stand-in
// emulator (tests/fake-synth.js). What the browser check (scripts/e2e) shows on a real table, here for every branch.
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGame, seats, start } from "./harness.ts";

// The page's globals from happy-dom, beside Node's own (vitest's happy-dom environment would replace Node's URL, which
// games-service's runtime needs).
const page = new Window({ url: "http://table.test/board/" });
for (const k of ["window", "document", "localStorage", "HTMLElement", "Node", "Event", "PointerEvent", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  (globalThis as any)[k] = k === "window" ? page : (page as any)[k];
}
declare const document: any, localStorage: any;
type HTMLElement = any;

const game = await loadGame("fm1-synth");
const FAKE_SYNTH = fileURLToPath(new URL("./fake-synth.js", import.meta.url));

const fw = (id: string, name: string) => ({ id, name, version: "1.0", author: `${name}'s author`, about: `About ${name}.`, package: `https://fw.test/${id}.fwsc` });
const CATALOGS: Record<string, object> = {
  "/emu/firmwares-fm1.json": { default: "alpha", firmwares: [fw("alpha", "Alpha"), fw("beta", "Beta"), fw("gamma", "Gamma")] },
  "/emu/firmwares-smk37.json": { default: "sigma", firmwares: [fw("sigma", "Sigma"), fw("tau", "Tau")] },
};

/** The made-up web: each package URL's status (200 unless set; "none" for no answer), and what was asked. */
let web: Record<string, number | "none">;
let asked: string[];
function fakeFetch(url: string, init?: { method?: string }) {
  asked.push(`${init?.method ?? "GET"} ${url}`);
  const reply = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    body: null,
    json: async () => body,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  if (CATALOGS[url]) return Promise.resolve(reply(200, CATALOGS[url]));
  if (url === "https://thefirmwarehub.com/catalog.json") return Promise.resolve(reply(200, { firmwares: [] }));
  const s = web[url] ?? 200;
  return s === "none" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(reply(s));
}

const synth = () => (globalThis as any).fakeSynth;
/** Until the board, the phone and the background checks have done what they can. */
const until = (what: () => unknown) => vi.waitFor(() => expect(what()).toBeTruthy(), { timeout: 3000, interval: 5 });

beforeEach(() => {
  vi.resetModules(); // (a fresh catalog module: its lists and checks are kept per page)
  web = {};
  asked = [];
  vi.stubGlobal("fetch", fakeFetch);
  (globalThis as any).fakeSynth = null;
  document.body.innerHTML = "";
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** A table: the game started on `device`, the board mounted on it (playing, or a remote board watching). */
async function table({ device = "fm1", local = true } = {}) {
  const { rt } = start(game, 1, { device }, 1, { seats: seats(1) });
  const info = {
    controlSeats: local ? [0] : [],
    players: [{ seat: 0, name: "Ann", connected: true }],
    seatPositions: { 0: { x: 960, y: 1000, rot: 0 } },
    rotation: 0,
    prefs: {},
    sound: true,
  };
  // @ts-expect-error: a plain module of the game\'s UIs
  const board = await import("../games/fm1-synth/board.js");
  const root = document.createElement("div");
  document.body.append(root);
  let inst: any;
  const refresh = () => inst.update(rt.boardView(), [], info);
  const ctx = {
    assetUrl: (p: string) => (p === "synth.js" ? FAKE_SYNTH : `/${p}`),
    act: async (seat: number, name: string, payload: unknown) => {
      const r = rt.submit(seat, { name, payload } as any, "board");
      refresh();
      return r;
    },
  };
  inst = board.mount(root, ctx);
  refresh();
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const $$ = (s: string) => [...root.querySelectorAll(s)] as HTMLElement[];
  /** What the phone does, from outside the board. */
  const phone = (name: string, payload: unknown) => {
    const r = rt.submit(0, { name, payload } as any, "human");
    refresh();
    return r;
  };
  return { rt, info, inst, root, refresh, phone, $, $$, state: () => rt.boardView() as any };
}

describe("the board", () => {
  it("starts the device's first firmware, boots it and says how it runs", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    expect(t.state()).toMatchObject({ firmware: "alpha", firmwareName: "Alpha", choice: 1 });
    expect(synth().plays).toEqual([{ id: "alpha", mhz: 100 }]);
    expect(synth().board).toBe(0);
    expect(synth().volume).toBe(0.8);
    synth().status("running", "Alpha is running");
    expect(t.state().status).toEqual({ state: "running", text: "Alpha is running" });
    expect(t.$(".fs-name").textContent).toBe("FM-1 · Alpha");
    expect(t.$(".fs-status").textContent).toBe("Alpha is running");
    expect(t.$(".fs-dot").dataset.state).toBe("running");
  });

  it("passes over a first firmware whose package is gone, without a word, and leaves it out of the window", async () => {
    web["https://fw.test/alpha.fwsc"] = 404;
    const t = await table();
    await until(() => synth()?.plays.length);
    expect(t.state()).toMatchObject({ firmware: "beta", choice: 1 });
    synth().status("running", "Beta is running");
    expect(t.$(".fs-status").textContent).toBe("Beta is running");
    t.inst.openPicker();
    await until(() => t.$$(".fs-card").length === 2);
    expect(t.$$(".fs-card").map((c) => c.dataset.id)).toEqual(["beta", "gamma"]);
    expect(t.$(".fs-sheet-title").textContent).toBe("Firmwares for the FM-1 (2)");
    // packages are only asked about (HEAD), the first firmware first
    expect(asked.filter((a) => a.endsWith(".fwsc")).every((a) => a.startsWith("HEAD "))).toBe(true);
    expect(asked.find((a) => a.endsWith(".fwsc"))).toBe("HEAD https://fw.test/alpha.fwsc");
  });

  it("plays the next firmware when its own first one fails to download, names it, and a tap tries it again", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    synth().status("error", "Alpha can't be downloaded from its author's site right now", { unavailable: true });
    await until(() => t.state().firmware === "beta");
    await until(() => synth().plays.length === 2);
    synth().status("running", "Beta is running");
    expect(t.state().status.text).toBe("Beta is running (Alpha can't be downloaded right now)");
    t.inst.openPicker();
    await until(() => t.$(".fs-card.gone[data-id=alpha]"));
    expect(t.$(".fs-card.gone[data-id=alpha] .fs-card-about").textContent).toBe("Can't be downloaded right now. Tap to try again.");
    // tapped: chosen again; it fails again, and now the player chose it: the board says so and stays
    t.$(".fs-card[data-id=alpha]").click();
    await until(() => t.state().firmware === "alpha");
    await until(() => synth().plays.length === 3);
    synth().status("error", "Alpha can't be downloaded from its author's site right now", { unavailable: true });
    expect(t.state()).toMatchObject({ firmware: "alpha", status: { state: "error" } });
    expect(t.state().status.text).toMatch(/Pick another firmware, or tap it again to try once more\.$/);
    // a tap on the chosen one after it failed boots it once more
    t.inst.openPicker();
    await until(() => t.$(".fs-card[data-id=alpha]"));
    t.$(".fs-card[data-id=alpha]").click();
    await until(() => synth().plays.length === 4);
    expect(t.state().choice).toBe(3);
  });

  it("says so when no firmware of the device can be downloaded", async () => {
    for (const id of ["alpha", "beta", "gamma"]) web[`https://fw.test/${id}.fwsc`] = 404;
    // (one site still answers, so the table has internet)
    const t = await table();
    await until(() => t.state().status.state === "error");
    expect(t.state().status.text).toBe("No firmware for the FM-1 can be downloaded right now. Check the table's internet connection.");
    expect(t.state().firmware).toBe(null);
  });

  it("keeps listing every firmware when no site answers at all (no internet)", async () => {
    for (const id of ["alpha", "beta", "gamma"]) web[`https://fw.test/${id}.fwsc`] = "none";
    const t = await table();
    await until(() => synth()?.plays.length);
    expect(t.state().firmware).toBe("alpha");
    t.inst.openPicker();
    await until(() => t.$$(".fs-card").length === 3);
  });

  it("leaves out a firmware whose site gives no answer while the others do", async () => {
    web["https://fw.test/gamma.fwsc"] = "none";
    const t = await table();
    await until(() => synth()?.plays.length);
    t.inst.openPicker();
    await until(() => t.$$(".fs-card").length === 2);
    expect(t.$(".fs-card[data-id=gamma]")).toBe(null);
  });

  it("says so when the device's firmware list cannot be loaded", async () => {
    const real = fakeFetch;
    vi.stubGlobal("fetch", (url: string, init?: object) => (url.endsWith("firmwares-fm1.json") ? Promise.resolve({ ok: false, status: 500 }) : real(url, init)));
    const t = await table();
    await until(() => t.state().status.state === "error");
    expect(t.state().status.text).toBe("The FM-1's firmware list could not be loaded (the FM-1's firmware list could not be loaded (500)). Tap Restart to try again.");
    t.inst.openPicker();
    await until(() => t.$(".fs-empty"));
    expect(t.$(".fs-empty").textContent).toMatch(/could not be loaded/);
  });

  it("switches firmware from its window, keeps it open for a star, and stars in place", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.$(".fs-pick").click();
    await until(() => t.$$(".fs-card").length === 3);
    expect(t.$(".fs-card.on").dataset.id).toBe("alpha");
    t.$(".fs-card[data-id=gamma] .fs-star").click();
    await until(() => t.state().favorites.fm1.length);
    expect(t.state().favorites.fm1).toEqual(["gamma"]);
    expect((t.$(".fs-picker") as any).hidden).toBe(false);
    // the order stays while the window is open; the star shows at once
    await until(() => t.$(".fs-card[data-id=gamma] .fs-star.starred"));
    expect(t.$$(".fs-card").map((c) => c.dataset.id)).toEqual(["alpha", "beta", "gamma"]);
    // opened again: starred first
    t.$(".fs-close").click();
    t.$(".fs-pick").click();
    await until(() => t.$$(".fs-card")[0]?.dataset.id === "gamma");
    t.$(".fs-card[data-id=beta]").click();
    expect((t.$(".fs-picker") as any).hidden).toBe(true);
    await until(() => synth().plays.length === 2);
    expect(t.state()).toMatchObject({ firmware: "beta", choice: 2 });
  });

  it("switches the device from the window's tab, on that device's first firmware", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.inst.openPicker();
    await until(() => t.$$(".fs-card").length);
    t.$(".fs-tab[data-device=smk37]").click();
    await until(() => synth().plays.length === 2);
    expect(t.state()).toMatchObject({ device: "smk37", firmware: "sigma" });
    expect(synth().board).toBe(1);
    expect(t.$(".fs-tab[data-device=smk37]").getAttribute("aria-selected")).toBe("true");
    await until(() => t.$(".fs-sheet-title").textContent === "Firmwares for the SMK-37 (2)");
    expect(t.$(".fs-name").textContent).toBe("SMK-37 · Sigma");
  });

  it("follows the phone: another firmware, another device", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.phone("firmware", { id: "gamma", name: "Gamma" });
    await until(() => synth().plays.length === 2);
    expect(synth().plays[1].id).toBe("gamma");
    t.phone("device", { device: "smk37" });
    await until(() => synth().plays.length === 3);
    expect(t.state()).toMatchObject({ device: "smk37", firmware: "sigma" });
  });

  it("boots again on Restart and with another clock from the settings", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.$(".fs-restart").click();
    await until(() => synth().plays.length === 2);
    t.info.prefs = { mhz: 160, volume: 40 };
    t.refresh();
    await until(() => synth().plays.length === 3);
    expect(synth().plays[2]).toEqual({ id: "alpha", mhz: 160 });
    expect(synth().volume).toBe(0.4);
    // the settings window offers the device, the volume, the clock, the firmware window and Restart
    // @ts-expect-error: a plain module of the game\'s UIs
    const board = await import("../games/fm1-synth/board.js");
    const items = board.settings({ info: t.info, setPrefs: () => {} });
    expect(items.map((i: { label: string }) => i.label)).toEqual(["Device", "Volume", "Emulated clock", "Firmware", "Restart"]);
    expect(items[0].value).toBe("fm1");
  });

  it("stops on Finish: no buttons, the emulator flushed", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.phone("finish", {});
    expect(t.$(".fs-status").textContent).toBe("Done");
    expect((t.$(".fs-actions") as any).hidden).toBe(true);
    expect(synth().flushed).toBe(true);
    t.inst.destroy();
    expect(synth().destroyed).toBe(true);
    expect(t.root.querySelector(".fs-root")).toBe(null);
  });

  it("on a remote board shows who plays where, and runs no emulator", async () => {
    const t = await table({ local: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(synth()).toBe(null);
    expect((t.$(".fs-away") as any).hidden).toBe(false);
    expect(t.$(".fs-away").textContent).toMatch(/Ann plays the FM-1 there/);
    expect((t.$(".fs-frame") as any).hidden).toBe(true);
    expect(t.state().firmware).toBe(null); // (the table's own board chooses)
  });

  it("turns the bar and the plate to face north", async () => {
    const t = await table();
    await until(() => synth()?.plays.length);
    t.info.rotation = 180;
    t.refresh();
    expect(t.root.querySelector(".fs-root")!.classList.contains("fs-north")).toBe(true);
    expect(synth().flipped).toBe(true);
  });
});

/** The phone: the deck mounted on the same game, its intents sent to the rules as the phone's. */
async function phoneOn({ device = "fm1" } = {}) {
  const { rt } = start(game, 1, { device }, 1, { seats: seats(1) });
  // @ts-expect-error: a plain module of the game\'s UIs
  const deck = await import("../games/fm1-synth/deck.js");
  const root = document.createElement("div");
  document.body.append(root);
  const sent: { name: string; payload: any }[] = [];
  let inst: any;
  const refresh = () => inst.update(rt.view(0));
  const ctx = {
    assetUrl: (p: string) => `/${p}`,
    send: (name: string, payload: unknown) => {
      sent.push({ name, payload });
      rt.submit(0, { name, payload } as any, "human");
      queueMicrotask(refresh);
    },
  };
  inst = deck.mount(root, ctx);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const $$ = (s: string) => [...root.querySelectorAll(s)] as HTMLElement[];
  /** What the board does. */
  const board = (name: string, payload: unknown) => {
    rt.submit(0, { name, payload } as any, "board");
    refresh();
  };
  return { rt, inst, root, refresh, sent, board, $, $$, state: () => rt.view(0) as any };
}

describe("the phone", () => {
  it("sends its stored stars once, and keeps the game's list in its browser", async () => {
    localStorage.setItem("fm1-synth.favorites", JSON.stringify({ fm1: ["gamma", 7], smk37: ["tau"], other: ["x"] }));
    const p = await phoneOn();
    // the game's answer takes a moment: views without the stars meanwhile do not send them again
    const before = p.state();
    p.inst.update(before);
    p.inst.update(before);
    expect(p.sent.filter((s) => s.name === "favorites")).toEqual([{ name: "favorites", payload: { list: { fm1: ["gamma"], smk37: ["tau"] } } }]);
    await until(() => p.state().favSynced);
    p.refresh();
    p.refresh();
    expect(p.sent.filter((s) => s.name === "favorites").length).toBe(1);
    p.board("star", { device: "fm1", id: "beta", on: true });
    expect(JSON.parse(localStorage.getItem("fm1-synth.favorites")!)).toEqual({ fm1: ["beta", "gamma"], smk37: ["tau"] });
  });

  it("starts without stars from a browser that has none or bad ones", async () => {
    localStorage.setItem("fm1-synth.favorites", "{not json");
    const p = await phoneOn();
    p.refresh();
    expect(p.sent[0]).toEqual({ name: "favorites", payload: { list: { fm1: [], smk37: [] } } });
  });

  it("lists the board's device's firmwares, starred first, without those that are gone", async () => {
    web["https://fw.test/beta.fwsc"] = 404;
    localStorage.setItem("fm1-synth.favorites", JSON.stringify({ fm1: ["gamma"], smk37: [] }));
    const p = await phoneOn();
    p.refresh();
    expect(p.$(".fd-list").textContent).toMatch(/Loading the firmware list/);
    await until(() => p.$$(".fd-fw").length === 2);
    expect(p.$$(".fd-fw").map((b) => b.dataset.id)).toEqual(["gamma", "alpha"]);
    expect(p.$(".fd-star.starred").dataset.id).toBe("gamma");
    p.board("firmware", { id: "alpha", name: "Alpha" });
    expect(p.$(".fd-fw.on").dataset.id).toBe("alpha");
    expect(p.$(".fd-name").textContent).toBe("Alpha");
    expect(p.$(".fd-dev").textContent).toBe("M-VAVE FM-1");
    // the board switches the device: the phone shows that device's list
    p.board("device", { device: "smk37" });
    await until(() => p.$$(".fd-fw").map((b) => b.dataset.id).join() === "sigma,tau");
    expect(p.$(".fd-dev-btn.on").dataset.device).toBe("smk37");
  });

  it("picks a firmware, stars one, and switches the device", async () => {
    const p = await phoneOn();
    p.refresh();
    await until(() => p.$$(".fd-fw").length === 3);
    p.$(".fd-fw[data-id=beta]").click();
    expect(p.sent.at(-1)).toEqual({ name: "firmware", payload: { id: "beta", name: "Beta", device: "fm1" } });
    await until(() => p.$(".fd-fw.on")?.dataset.id === "beta");
    // the chosen one again: nothing sent
    const n = p.sent.length;
    p.$(".fd-fw[data-id=beta]").click();
    expect(p.sent.length).toBe(n);
    p.$(".fd-star[data-id=gamma]").click();
    expect(p.sent.at(-1)).toEqual({ name: "star", payload: { device: "fm1", id: "gamma", on: true } });
    await until(() => p.$(".fd-star.starred"));
    p.$(".fd-star[data-id=gamma]").click();
    expect(p.sent.at(-1)).toEqual({ name: "star", payload: { device: "fm1", id: "gamma", on: false } });
    p.$(".fd-dev-btn[data-device=smk37]").click();
    expect(p.sent.at(-1)).toEqual({ name: "device", payload: { device: "smk37" } });
    // the device it is on already: nothing sent
    await until(() => p.$(".fd-dev-btn.on")?.dataset.device === "smk37");
    const m = p.sent.length;
    p.$(".fd-dev-btn[data-device=smk37]").click();
    expect(p.sent.length).toBe(m);
  });

  it("asks before Finish: Keep playing goes back, Finish ends the game", async () => {
    const p = await phoneOn();
    p.refresh();
    p.$(".fd-finish").click();
    expect((p.$(".fd-confirm") as any).hidden).toBe(false);
    expect((p.$(".fd-finish") as any).hidden).toBe(true);
    p.$(".fd-keep").click();
    expect((p.$(".fd-confirm") as any).hidden).toBe(true);
    expect(p.sent.some((s) => s.name === "finish")).toBe(false);
    p.$(".fd-finish").click();
    p.$(".fd-end").click();
    expect(p.sent.at(-1)).toEqual({ name: "finish", payload: {} });
    await until(() => p.state().done);
    await until(() => (p.$(".fd-finish") as any).disabled);
    expect(p.$(".fd-text").textContent).toBe("Done");
    expect(p.$$(".fd-fw").every((b) => (b as any).disabled)).toBe(true);
  });

  it("says so when the list cannot be loaded, and asks again by itself", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let down = true;
      vi.stubGlobal("fetch", (url: string, init?: object) =>
        down && url.endsWith("firmwares-fm1.json") ? Promise.resolve({ ok: false, status: 503 }) : fakeFetch(url, init as any));
      const p = await phoneOn();
      p.refresh();
      await vi.waitFor(() => expect(p.$(".fd-list").textContent).toMatch(/could not be loaded\. Trying again/));
      down = false;
      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() => expect(p.$$(".fd-fw").length).toBe(3));
      p.inst.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
