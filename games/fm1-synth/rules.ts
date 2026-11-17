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
  /** The starred firmwares per device, newest star first (E-013). Kept on the table between games (E-020): the board
   * sends the table's lists once (`favorites`), then keeps the table's copy in step with these. On a table without
   * game data, the phone does that with its own list, as before. */
  favorites: Record<Device, string[]>;
  /** The unliked firmwares per device, newest last (E-020): shown greyed at the end of the lists. Never also starred. */
  unliked: Record<Device, string[]>;
  /** The lists from earlier games have come (the table's, or the phone's for this player). */
  favSynced: boolean;
  /** The lists are the table's (E-020), shared by everyone who plays here: they stay when the seat changes hands. */
  shared: boolean;
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
    unliked: s.unliked,
    favSynced: s.favSynced,
    shared: s.shared,
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
  if (name === "unlike" && step.accepted) {
    const p = step.intent.payload as { id?: string; on?: boolean };
    return { text: `${p.on ? "unlikes" : "takes the unlike off"} ${p.id}` };
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
      unliked: noFavorites(),
      favSynced: false,
      shared: false,
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
      case "star":
      case "unlike": {
        // A star on (to the front: newest first) or off, or an unlike on (to the end: newest last) or off, from the
        // board's firmware window or the phone (E-013, E-020). A firmware has one or neither: a star takes the unlike
        // off, an unlike takes the star off.
        const device = p.device as Device;
        const id = typeof p.id === "string" ? p.id : "";
        if (!DEVICES.includes(device)) return { reject: "That is not a device of this game" };
        if (!ID.test(id)) return { reject: "That is not a firmware of this device" };
        const on = p.on === true;
        const star = intent.name === "star";
        // off: only its own list changes; on: it goes to its list and leaves the other
        let favorites = !on && !star ? state.favorites[device] : state.favorites[device].filter((f) => f !== id);
        let down = !on && star ? state.unliked[device] : state.unliked[device].filter((f) => f !== id);
        if (on && star) favorites = [id, ...favorites].slice(0, MAX_FAVORITES);
        if (on && !star) down = [...down, id].slice(-MAX_FAVORITES);
        if (favorites.join() === state.favorites[device].join() && down.join() === state.unliked[device].join()) return { state };
        return { state: { ...state, favorites: { ...state.favorites, [device]: favorites }, unliked: { ...state.unliked, [device]: down } } };
      }
      case "favorites": {
        // The lists from earlier games: the table's, sent by the board (`shared`, E-020), or on a table without game
        // data the phone's, once. Stars and unlikes given before they came stay (newer). `merge` adds a phone's old
        // list to the table's, once the table's are here (the move from the phone to the table).
        const merge = p.merge === true && state.shared;
        const tables = p.shared === true && !state.shared; // the table's lists come once, whatever came before
        if (state.favSynced && !merge && !tables) return { state };
        const ids = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string" && ID.test(x)) : []);
        const sent = (p.list ?? {}) as Record<string, unknown>;
        const sentDown = (p.unliked ?? {}) as Record<string, unknown>;
        const favorites = noFavorites();
        const unliked = noFavorites();
        for (const d of DEVICES) {
          favorites[d] = [...new Set([...state.favorites[d], ...ids(sent[d])])].filter((id) => !state.unliked[d].includes(id)).slice(0, MAX_FAVORITES);
          // an unlike from before gives way to a star (here or in the list that came)
          unliked[d] = [...new Set([...ids(sentDown[d]), ...state.unliked[d]])].filter((id) => !favorites[d].includes(id)).slice(-MAX_FAVORITES);
        }
        const next = { ...state, favorites, unliked, favSynced: true, shared: state.shared || p.shared === true };
        if (JSON.stringify([next.favorites, next.unliked, next.shared]) === JSON.stringify([state.favorites, state.unliked, state.shared]) && state.favSynced) return { state };
        return { state: next };
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
    // The table's stars and unlikes are everyone's who plays here (E-020). On a table without game data they are the
    // player's own: another person's phone brings theirs (E-013).
    if (state.shared) return { state: { ...state, player: seat.name } };
    return { state: { ...state, player: seat.name, favorites: noFavorites(), unliked: noFavorites(), favSynced: false } };
  },

  describe: describeStep,
});
