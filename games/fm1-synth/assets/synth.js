// The emulated FM-1 or SMK-37 on Game Table's board: the front panel on a canvas (drawn by the emulator's Rust code in
// a wasm instance of its own), played by touch only, and the machine itself in an AudioWorklet (emu/worklet.js, the
// web page's own). A trimmed web/main.js: no keyboard, MIDI, local files, try-outs or backups. Settings and patches a
// firmware saves to its flash are kept in this browser (IndexedDB, web/persistence.js), per firmware package.
import { fetchPackage } from "./emu/fwsc.js";
import { SaveStore, packageHash, changedSectors, packSectors } from "./emu/persistence.js";

const NKEY = 37; // SMK-37: keys 0..36, buttons from 37
const PITCH_REST = 535, MOD_REST = 629;

/**
 * new Synth(canvas, { base, onStatus, onBoard })
 *   base      the URL of this folder (for emu/…)
 *   onStatus  (state, text): "idle" | "loading" | "running" | "error", and words for people; on an error, { unavailable }
 *             when the package could not be downloaded
 *   onBoard   (board): the panel changed (0 FM-1, 1 SMK-37); the canvas has its new size
 * Then: await synth.init(); synth.play(entry, mhz) boots a catalog entry; synth.resume() from a tap.
 */
/** Two arrays (or two missing ones) hold the same values. */
const same = (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

export class Synth {
  constructor(canvas, { base, onStatus = () => {}, onBoard = () => {} }) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.base = base;
    this.onStatus = onStatus;
    this.onBoard = onBoard;
    this.flipped = false; // the board's game faces north: the panel is turned 180°
    this.saves = new SaveStore();
    this.packages = new Map();
    this.down = new Uint8Array(64);
    this.holds = new Uint8Array(64);
    this.encClicks = new Int32Array(8);
    this.turning = new Uint32Array(9);
    this.pot = 900;
    this.analog = new Uint16Array(23);
    this.analog[20] = PITCH_REST;
    this.analog[21] = MOD_REST;
    this.pointers = new Map();
    this.frame = null;
    this.board = -1;
    this.seq = 0;
    this.session = null;
    this.waiters = new Map();
    this.volume = 0.8;
    this.muted = false;
    this.dead = false;
    this.dirty = true; // something to draw: a new frame from the machine, a touch, another panel
    this.image = null; // the panel's pixels in wasm memory, as ImageData (rebuilt when the memory grows)
  }

  async init() {
    this.wasm = await (await fetch(`${this.base}emu/fm1_web.wasm`)).arrayBuffer();
    // (the panel's instance runs no machine: its JIT import is never called)
    this.ui = (await WebAssembly.instantiate(this.wasm, { env: { fm1_jit_compile: () => 0 } })).instance.exports;
    this.setBoard(0);
    this.listen();
    const draw = () => {
      if (this.dead) return;
      this.draw();
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  /** The audio graph; a browser may keep it suspended until the board is touched (resume() then). */
  async audio() {
    if (this.ac) return;
    this.ac = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
    this.gain = this.ac.createGain();
    this.gain.connect(this.ac.destination);
    this.applyVolume();
    await this.ac.audioWorklet.addModule(`${this.base}emu/worklet.js`);
    if (this.dead) return;
    this.node = new AudioWorkletNode(this.ac, "fm1", { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.gain);
    this.node.port.onmessage = (e) => this.message(e.data);
    this.ac.resume().catch(() => {});
  }

  /** Whether the sound runs: false until the board has been touched where the browser wants a gesture first. */
  get audible() {
    return this.ac?.state === "running";
  }

  resume() {
    return this.ac?.resume().catch(() => {});
  }

  setVolume(v, muted = this.muted) {
    this.volume = Math.max(0, Math.min(1, v));
    this.muted = muted;
    this.applyVolume();
  }

  applyVolume() {
    if (!this.gain) return;
    this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ac.currentTime, 0.02);
  }

  setBoard(b) {
    if (b === this.board) return;
    this.board = b;
    this.ui.panel_board(b);
    this.W = this.ui.panel_width();
    this.H = this.ui.panel_height();
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.dirty = true;
    this.down.fill(0);
    this.encClicks.fill(0);
    this.onBoard(b);
  }

  /** Boot a catalog entry ({ id, name, package, … }) at `mhz`. Resolves when it runs (or failed: see onStatus). */
  async play(entry, mhz = 100) {
    const seq = ++this.seq;
    this.onStatus("loading", `Loading ${entry.name}…`);
    try {
      await this.audio();
      const got = this.packages.get(entry.id) ?? (await this.kept(entry)) ?? (await this.download(entry));
      this.packages.set(entry.id, got);
      if (seq !== this.seq || this.dead) return;
      const hash = await packageHash(got.bytes);
      let record = null;
      try {
        record = await this.saves.load(hash);
      } catch {}
      await this.flush(true);
      if (seq !== this.seq || this.dead) return;
      const session = { seq, hash, entry: `game.${entry.id}`, revision: record?.revision ?? 0, sectors: record?.sectors ?? [],
        record: { version: 1, hash, name: entry.name, byo: false, device: this.board === 1 ? "smk37" : "fm1", package: got.bytes, url: got.url } };
      this.pending = session;
      this.down.fill(0);
      this.holds.fill(0);
      this.pointers.clear();
      this.encClicks.fill(0);
      this.frame = null;
      this.dirty = true;
      const booted = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the firmware did not boot in time")), 30000);
        this.waiters.set(seq, { resolve, reject, timer });
      });
      this.node.port.postMessage({ type: "boot", seq, wasm: this.wasm.slice(0), package: got.bytes.slice().buffer,
        sectors: packSectors(session.sectors).buffer, syx: null, script: null, mhz, jit: true });
      await booted;
      if (seq !== this.seq) return;
      this.onStatus("running", `${entry.name} is running`);
    } catch (error) {
      if (seq !== this.seq || this.dead) return;
      this.node?.port.postMessage({ type: "resume" });
      this.onStatus("error", error.unavailable ? error.message : `${entry.name}: ${error.message}`, { unavailable: !!error.unavailable });
    } finally {
      this.waiters.delete(seq);
    }
  }

  /** A firmware's package from its author's site; a failure says so in words, marked `unavailable`. */
  async download(entry) {
    try {
      return await fetchPackage(entry);
    } catch (cause) {
      const e = new Error(`${entry.name} can't be downloaded from its author's site right now`, { cause });
      e.unavailable = true;
      throw e;
    }
  }

  /** The package this browser kept for a firmware (a site that is down then costs nothing). */
  async kept(entry) {
    try {
      const k = await this.saves.entry(`game.${entry.id}`);
      return k ? { bytes: k.package, url: k.url } : null;
    } catch {
      return null;
    }
  }

  message(m) {
    if (m.type === "error") {
      const w = this.waiters.get(m.seq);
      if (w) {
        clearTimeout(w.timer);
        w.reject(new Error(m.message));
      } else if (m.seq === this.seq) this.onStatus("error", m.message);
      if (m.fatal && this.session?.seq === m.seq) this.session = null;
      return;
    }
    if (m.type === "booted") {
      const w = this.waiters.get(m.seq);
      if (!w || this.pending?.seq !== m.seq) return;
      this.session = this.pending;
      this.session.base = m.base;
      this.store(m.flash);
      clearTimeout(w.timer);
      w.resolve();
      this.setBoard(m.board);
      if (m.board === 1) for (let i = 16; i < 22; i++) this.send({ type: "analog", idx: i, value: this.analog[i] });
      return;
    }
    if (m.type === "snapshot") {
      if (m.flash && this.session?.seq === m.seq) this.store(m.flash);
      const w = this.waiters.get(`snap${m.request}`);
      if (w) {
        clearTimeout(w.timer);
        w.resolve();
      }
      return;
    }
    if (m.type === "frame" && m.seq === this.seq) {
      const was = this.frame;
      if (!m.lcd && was?.lcd) m.lcd = was.lcd;
      // drawn again only when the screen, an LED or a pad changed (the machine sends frames all the time)
      if (m.lcd || !was || !same(m.leds, was.leds) || !same(m.pads, was.pads)) this.dirty = true;
      this.frame = m;
      if (m.halted && !this.halted) this.onStatus("error", "The emulated CPU halted");
      this.halted = m.halted;
    }
  }

  /** Keep the firmware's flash as it changed from its package's own (only the sectors it wrote). */
  store(flash) {
    const s = this.session;
    if (!s?.base) return;
    const sectors = changedSectors(s.base, flash);
    // one save at a time, each with the revision the one before it wrote (the store refuses a stale one)
    s.saving = (s.saving ?? Promise.resolve())
      .then(() => this.saves.save({ ...s.record, sectors, revision: s.revision }, s.entry))
      .then((rev) => (s.revision = rev))
      .catch(() => {}); // (no storage: it plays on, unsaved)
  }

  /** Ask the running machine for its flash and keep it (before another firmware boots, and on leaving). */
  async flush(pause = false) {
    const s = this.session;
    if (!s || !this.node) return;
    const request = `${s.seq}.${Date.now()}`;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      this.waiters.set(`snap${request}`, { resolve, timer });
      this.node.port.postMessage({ type: "snapshot", seq: s.seq, request, pause });
    });
    this.waiters.delete(`snap${request}`);
    await s.saving;
  }

  send(m) {
    this.node?.port.postMessage(m);
  }

  /** One animation frame: the panel is drawn again only when something changed (or a knob's turn still shows). */
  draw() {
    if (!this.dirty && !this.turning.some(Boolean)) return;
    this.dirty = false;
    const ui = this.ui;
    const mem = () => ui.memory.buffer;
    const f = this.frame;
    if (f) {
      if (f.lcd) {
        new Uint16Array(mem(), ui.panel_lcd(), 240 * 240).set(f.lcd);
        f.lcd = null;
      }
      new Float32Array(mem(), ui.panel_leds(), 41).set(f.leds);
      if (f.pads) for (let p = 0; p < 16; p++) ui.panel_set(5, p, f.pads[p]);
    }
    for (let i = 0; i < 64; i++) ui.panel_set(0, i, this.down[i]);
    for (let i = 0; i < 8; i++) ui.panel_set(1, i, this.encClicks[i]);
    ui.panel_set(2, 0, this.pot);
    for (let i = 0; i < 9; i++) {
      ui.panel_set(3, i, this.turning[i]);
      if (this.turning[i] && --this.turning[i] === 0) this.dirty = true; // once more, without the turn
    }
    if (this.board === 1) for (let i = 0; i < 23; i++) ui.panel_set(4, i, this.analog[i]);
    const p = ui.panel_draw();
    const img = this.image;
    if (!img || img.data.buffer !== mem() || img.data.byteOffset !== p || img.width !== this.W || img.height !== this.H) {
      this.image = new ImageData(new Uint8ClampedArray(mem(), p, this.W * this.H * 4), this.W, this.H);
    }
    this.g.putImageData(this.image, 0, 0);
  }

  // ------------------------------------------------------------- touch
  setKey(id, on) {
    if (this.down[id] === (on ? 1 : 0)) return;
    this.down[id] = on ? 1 : 0;
    this.dirty = true;
    this.send({ type: "key", id, down: on });
  }
  turn(i, clicks) {
    this.encClicks[i] += clicks;
    this.dirty = true;
    this.turning[i] = 10;
    this.send({ type: "enc", enc: this.ui.panel_enc_id(i), clicks });
  }
  setPot(v) {
    this.pot = Math.max(0, Math.min(1023, Math.round(v)));
    this.dirty = true;
    this.turning[7] = 10;
    this.send({ type: "pot", value: this.pot });
  }
  setAnalog(i, v) {
    v = Math.max(0, Math.min(1023, Math.round(v)));
    if (this.analog[i] === v) return;
    this.analog[i] = v;
    this.dirty = true;
    this.send({ type: "analog", idx: i, value: v });
  }
  /** SMK-37: the next keys' velocity, 0 (softest) .. 1 (hardest), as the time between a key's two contacts. */
  setVelocity(f) {
    this.send({ type: "vel", us: Math.round(Math.exp(Math.log(80000) + (Math.log(2000) - Math.log(80000)) * Math.max(0, Math.min(1, f)))) });
  }
  press(id) {
    if (this.holds[id]++ === 0) this.setKey(id, true);
  }
  unpress(id) {
    if (this.holds[id] && --this.holds[id] === 0) this.setKey(id, false);
  }

  /** A touch's place on the panel, in panel pixels (the board scales the surface, and may turn the game 180°). */
  at(e) {
    const r = this.canvas.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (this.flipped) [x, y] = [1 - x, 1 - y];
    return [x * this.W, y * this.H];
  }

  slide(p, y) {
    const ui = this.ui;
    if (p.grab < 300) this.setAnalog(p.grab - 200, 700);
    else if (p.grab < 400) this.setAnalog(16 + p.grab - 300, ui.panel_slide(p.grab - 300, y));
    else this.setAnalog(p.grab === 400 ? 20 : 21, ui.panel_slide(p.grab === 400 ? 4 : 5, y));
  }

  listen() {
    const c = this.canvas, ui = this.ui;
    // Every finger on its own: a chord, or a key held while another finger turns a knob.
    this.onDown = (e) => {
      e.preventDefault();
      if (!this.audible) this.resume();
      const [x, y] = this.at(e);
      const p = { grab: ui.panel_hit(x, y), lastY: y, acc: 0, held: -1 };
      this.pointers.set(e.pointerId, p);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {}
      if (p.grab >= 100 && p.grab < 200) {
        p.held = p.grab - 100;
        if (this.board === 1 && p.held < NKEY) this.setVelocity(ui.panel_hit_y());
        this.press(p.held);
      } else if (this.board === 1 && p.grab >= 200) this.slide(p, y);
    };
    this.onMove = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || p.grab < 0) return;
      const [x, y] = this.at(e);
      const keys = this.board === 1 ? [0, NKEY] : [14, 41];
      if (p.grab >= 100 && p.grab < 200 && p.held >= keys[0] && p.held < keys[1]) {
        const h = ui.panel_hit(x, y); // glissando over the note keys
        if (h >= 100 + keys[0] && h < 100 + keys[1] && h - 100 !== p.held) {
          this.unpress(p.held);
          p.held = h - 100;
          if (this.board === 1) this.setVelocity(ui.panel_hit_y());
          this.press(p.held);
        }
      } else if (this.board === 1 && p.grab >= 300) {
        this.slide(p, y);
      } else if (p.grab >= 0 && p.grab < (this.board === 1 ? 8 : 7)) {
        // a knob: drag up or down, a click every 12 panel pixels
        p.acc += p.lastY - y;
        while (p.acc >= 12) {
          p.acc -= 12;
          this.turn(p.grab, 1);
        }
        while (p.acc <= -12) {
          p.acc += 12;
          this.turn(p.grab, -1);
        }
      } else if (this.board === 0 && p.grab === 7) {
        this.setPot(this.pot + (p.lastY - y) * 4);
      }
      p.lastY = y;
    };
    this.onUp = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (p.held >= 0) this.unpress(p.held);
      if (this.board === 1 && p.grab >= 200 && p.grab < 216) this.setAnalog(p.grab - 200, 0); // a pad let go
      if (this.board === 1 && p.grab === 400) this.setAnalog(20, PITCH_REST); // the pitch wheel springs back
      this.pointers.delete(e.pointerId);
    };
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("lostpointercapture", this.onUp);
  }

  async destroy() {
    if (this.dead) return;
    this.seq++;
    try {
      await this.flush(true);
    } catch {}
    this.dead = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("lostpointercapture", this.onUp);
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    await this.ac?.close().catch(() => {});
  }
}
