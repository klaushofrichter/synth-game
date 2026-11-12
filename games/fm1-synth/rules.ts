// FM-1 Synth: an emulated M-VAVE FM-1 or SMK-37 on the board, for one player at the table (decisions E-001..E-006).
// The emulator runs in the board's browser (board.js, assets/synth.js); these rules only keep what the table shares
// about it: which device, which firmware is chosen (by the player's phone or on the board), how the board says it
// runs, and when the player is done. No chance and no secrets: every view is the same.
import { count, defineGame, list, type GameContext, type SeatInfo, type StepInfo, type StepDescription } from "@game-table/sdk";

export type Device = "fm1" | "smk37";
export type RunState = "idle" | "loading" | "running" | "error";

export interface Played {
  id: string;
  name: string;
  device: Device;
  /** Game time (ms) the firmware was chosen. */
  at: number;
}

export interface State {
  /** The device on the board now: the setting at the start, switched during the game by a `device` intent (E-006). */
  device: Device;
  /** The firmware chosen (a catalog id); null until the board names its default. */
  firmware: string | null;
  firmwareName: string;
  /** Counts firmware choices: a status from the board names the choice it is about. */
  choice: number;
  status: { state: RunState; text: string };
  played: Played[];
  player: string;
  seat: number;
  done: boolean;
  endedAt: number | null;
  /** The player's starred firmwares per device, newest star first (E-013). Kept on the player's phone between games:
   * the phone sends its list once (`favorites`), then keeps a copy of this one. */
  favorites: Record<Device, string[]>;
  /** The phone has sent its list (for this player). */
  favSynced: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DEVICES: Device[] = ["fm1", "smk37"];
const DEVICE_NAME: Record<Device, string> = { fm1: "FM-1", smk37: "SMK-37" };
const STATES: RunState[] = ["idle", "loading", "running", "error"];
/** At most this many stars per device (more than either catalog lists). */
const MAX_FAVORITES = 200;
const noFavorites = (): Record<Device, string[]> => ({ fm1: [], smk37: [] });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

function choose(state: State, device: Device, id: string, name: string, ctx: GameContext): State {
  const known = state.played.some((p) => p.id === id && p.device === device);
  return {
    ...state,
    device,
    firmware: id,
    firmwareName: name || id,
    choice: state.choice + 1,
    status: { state: "loading", text: `Loading ${name || id}…` },
    played: known ? state.played : [...state.played, { id, name: name || id, device, at: ctx.now() }],
  };
}

/**
 * What was played, in words: "Felucca and AMB-1 on the FM-1", or with both devices each firmware with its own:
 * "Felucca on the FM-1 and Erik37 on the SMK-37".
 */
function playedText(s: State) {
  const devices = [...new Set(s.played.map((p) => p.device))];
  if (!s.played.length) return `the ${DEVICE_NAME[s.device]}`;
  if (devices.length === 1) return `${list(s.played.map((p) => p.name))} on the ${DEVICE_NAME[devices[0]]}`;
  return list(devices.map((d) => `${list(s.played.filter((p) => p.device === d).map((p) => p.name))} on the ${DEVICE_NAME[d]}`));
}

function minutes(s: State) {
  return Math.max(0, Math.round((s.endedAt ?? 0) / 60000));
}

function view(s: State) {
  return {
    device: s.device,
    firmware: s.firmware,
    firmwareName: s.firmwareName,
    choice: s.choice,
    status: s.status,
    played: s.played.map((p) => ({ id: p.id, name: p.name, device: p.device })),
    seat: s.seat,
    done: s.done,
    favorites: s.favorites,
    favSynced: s.favSynced,
  };
}

function describeStep(step: StepInfo<State>): StepDescription | null {
  if (step.kind !== "intent" || !step.intent) return null;
  const { name } = step.intent;
  if (name === "firmware") return { text: step.accepted ? `picks ${step.after.firmwareName}` : "tries to pick a firmware" };
  if (name === "device") return step.accepted ? { text: `switches to the ${DEVICE_NAME[step.after.device]}` } : null;
  if (name === "status") return step.accepted ? { text: `board: ${step.after.status.text || step.after.status.state}` } : null;
  if (name === "star" && step.accepted) {
    const p = step.intent.payload as { id?: string; on?: boolean };
    return { text: `${p.on ? "stars" : "unstars"} ${p.id}` };
  }
  if (name === "finish") return { text: "is done playing" };
  return null;
}

export default defineGame<State>({
  setup(ctx, settings) {
    const me: SeatInfo | undefined = ctx.seats[0];
    return {
      device: settings.device === "smk37" ? "smk37" : "fm1",
      firmware: null,
      firmwareName: "",
      choice: 0,
      status: { state: "idle", text: "" },
      played: [],
      player: me?.name ?? "",
      seat: me?.seat ?? 0,
      done: false,
      endedAt: null,
      favorites: noFavorites(),
      favSynced: false,
    };
  },

  onIntent(state, seat, intent, ctx) {
    if (state.done) return { reject: "The session is over" };
    const p = (intent.payload ?? {}) as Record<string, unknown>;
    switch (intent.name) {
      case "firmware": {
        // a firmware of the device on the board, or of the other one (`device`): the board switches with it
        const id = typeof p.id === "string" ? p.id : "";
        const device = p.device === undefined ? state.device : (p.device as Device);
        if (!DEVICES.includes(device)) return { reject: "That is not a device of this game" };
        if (!ID.test(id)) return { reject: "That is not a firmware of this device" };
        if (id === state.firmware && device === state.device) return { state };
        const next = choose(state, device, id, text(p.name, 80), ctx);
        return { state: next, events: [{ name: "firmware", data: { id, device, choice: next.choice } }] };
      }
      case "device": {
        // the other device, on its first firmware: the board names it (its catalog's default), as at the start
        const device = p.device as Device;
        if (!DEVICES.includes(device)) return { reject: "That is not a device of this game" };
        if (device === state.device) return { state };
        const next: State = { ...state, device, firmware: null, firmwareName: "", choice: state.choice + 1, status: { state: "idle", text: "" } };
        return { state: next, events: [{ name: "device", data: { device } }] };
      }
      case "status": {
        // The board says how the chosen firmware runs; a report about an earlier choice is dropped.
        const st = p.state as RunState;
        if (!STATES.includes(st)) return { reject: "Unknown status" };
        if (p.choice !== state.choice) return { reject: "That firmware is no longer chosen" };
        const next = { state: st, text: text(p.text, 160) };
        if (next.state === state.status.state && next.text === state.status.text) return { state };
        return { state: { ...state, status: next } };
      }
      case "star": {
        // a star on (to the front: newest first) or off, from the board's firmware window or the phone (E-013)
        const device = p.device as Device;
        const id = typeof p.id === "string" ? p.id : "";
        if (!DEVICES.includes(device)) return { reject: "That is not a device of this game" };
        if (!ID.test(id)) return { reject: "That is not a firmware of this device" };
        const rest = state.favorites[device].filter((f) => f !== id);
        const list = p.on === true ? [id, ...rest].slice(0, MAX_FAVORITES) : rest;
        if (list.join() === state.favorites[device].join()) return { state };
        return { state: { ...state, favorites: { ...state.favorites, [device]: list } } };
      }
      case "favorites": {
        // the phone's list from earlier games, once; stars given before it came stay in front (newer)
        if (state.favSynced) return { state };
        const sent = (p.list ?? {}) as Record<string, unknown>;
        const favorites = noFavorites();
        for (const d of DEVICES) {
          const theirs = Array.isArray(sent[d]) ? (sent[d] as unknown[]).filter((x): x is string => typeof x === "string" && ID.test(x)) : [];
          favorites[d] = [...new Set([...state.favorites[d], ...theirs])].slice(0, MAX_FAVORITES);
        }
        return { state: { ...state, favorites, favSynced: true } };
      }
      case "finish":
        return { state: { ...state, done: true, endedAt: ctx.now() }, events: [{ name: "finished" }] };
      default:
        return { reject: "Not something this game knows" };
    }
  },

  view: (state) => view(state),
  boardView: (state) => view(state),

  isOver(state) {
    if (!state.done) return null;
    const m = minutes(state);
    return {
      text: `${state.player || "The player"} played ${playedText(state)}${m ? ` for ${count(m, "minute")}` : ""}.`,
      highlights: { devices: [...new Set(state.played.map((p) => p.device))], firmwares: state.played.map((p) => `${p.device}/${p.id}`), minutes: m },
      table: { columns: ["Player", "Firmwares", "Minutes"], rows: [[state.player, state.played.length, m]] },
    };
  },

  onSeatChanged(state, seat) {
    // another person: their phone brings their own stars (E-013)
    return { state: { ...state, player: seat.name, favorites: noFavorites(), favSynced: false } };
  },

  describe: describeStep,
});
