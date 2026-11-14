// A stand-in for assets/synth.js in the board's tests: no wasm and no sound, it records what the board asks of it and
// lets a test say how the firmware runs (`fake.status(...)`, as the emulator's onStatus would).
export class Synth {
  constructor(canvas, opts) {
    this.opts = opts;
    this.W = 1280;
    this.H = 820;
    this.audible = true;
    this.plays = [];
    this.board = null;
    this.flushed = false;
    this.destroyed = false;
    globalThis.fakeSynth = this;
  }
  async init() {}
  setVolume(volume, muted) {
    this.volume = volume;
    this.muted = muted;
  }
  setBoard(b) {
    this.board = b;
  }
  async play(entry, mhz) {
    this.plays.push({ id: entry.id, mhz });
  }
  resume() {
    return Promise.resolve();
  }
  flush() {
    this.flushed = true;
  }
  destroy() {
    this.destroyed = true;
  }
  /** How the firmware runs, as the emulator reports it. */
  status(state, text, problem) {
    this.opts.onStatus(state, text, problem);
  }
}
