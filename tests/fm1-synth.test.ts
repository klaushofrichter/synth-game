// FM-1 Synth's rules on games-service's own runtime: choosing firmwares, the board's status reports, finishing, the
// summary, exact replay, a player exchanged mid-game and the player's starred firmwares (E-013).
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
