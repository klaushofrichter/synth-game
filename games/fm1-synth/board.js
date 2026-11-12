// FM-1 Synth on the board: the emulated device's front panel, played by touch, a slim bar above it (the firmware,
// how it runs, a firmware picker) and the platform's seat plate below. The emulator runs only on the table's own board
// for the player sitting at it (E-002); a remote board (a watcher) shows the bar and a note instead.
import { esc, html, seatPlates, useStyles } from "/shared/board-kit.js";

const ID = "fm1-synth";
const DEVICES = [{ id: "fm1", name: "FM-1" }, { id: "smk37", name: "SMK-37" }];
const deviceName = (d) => (d === "smk37" ? "SMK-37" : "FM-1");
const CLOCKS = [60, 80, 100, 120, 160, 200, 240];
const VOLUMES = [0, 20, 40, 60, 80, 100];
const prefsOf = (info) => ({
  volume: VOLUMES.includes(info?.prefs?.volume) ? info.prefs.volume : 80,
  mhz: CLOCKS.includes(info?.prefs?.mhz) ? info.prefs.mhz : 100,
});

/** The mounted board, for the settings window's buttons. */
let live = null;

export function settings({ info, setPrefs }) {
  const p = prefsOf(info);
  const device = live?.device();
  return [
    // the device on the board now; the game setting "Device to start with" is locked once the game runs (E-006)
    ...(device
      ? [{
          type: "choice",
          label: "Device",
          hint: "Switch the board to the other device; it starts on that device's first firmware.",
          value: device,
          options: DEVICES.map((d) => ({ value: d.id, label: d.name })),
          onChange: (v) => live?.setDevice(v),
        }]
      : []),
    {
      type: "choice",
      label: "Volume",
      value: String(p.volume),
      options: VOLUMES.map((v) => ({ value: String(v), label: v ? `${v}%` : "Off" })),
      onChange: (v) => setPrefs({ volume: Number(v) }),
    },
    {
      type: "choice",
      label: "Emulated clock",
      hint: "The real device runs at 240 MHz. A lower clock is easier on this computer; most firmwares play fine at 100.",
      value: String(p.mhz),
      options: CLOCKS.map((c) => ({ value: String(c), label: `${c} MHz` })),
      onChange: (v) => setPrefs({ mhz: Number(v) }),
    },
    { type: "button", label: "Firmware", action: "Choose a firmware…", onChange: () => live?.openPicker() },
    { type: "button", label: "Restart", action: "Restart the firmware", onChange: () => live?.restart() },
  ];
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/board.css`);
  const box = html(`<div class="fs-root">
    <div class="fs-game">
      <div class="fs-bar">
        <div class="fs-now"><span class="fs-dot"></span><div><div class="fs-name"></div><div class="fs-status"></div></div></div>
        <div class="fs-actions">
          <button class="fs-btn fs-restart" type="button">Restart</button>
          <button class="fs-btn fs-pick primary" type="button">Firmware…</button>
        </div>
      </div>
      <div class="fs-stage"><div class="fs-frame"><canvas class="fs-panel" aria-label="Synthesizer front panel"></canvas>
        <div class="fs-tap" hidden>Tap the synth to turn its sound on</div></div>
        <div class="fs-away" hidden></div></div>
      <div class="fs-picker" hidden>
        <div class="fs-sheet">
          <div class="fs-sheet-head"><div><div class="fs-sheet-title"></div><div class="fs-sheet-sub muted">Tap one to play it. It is downloaded from its author's site.</div></div>
            <div class="fs-tabs" role="tablist">${DEVICES.map((d) => `<button class="fs-tab" type="button" role="tab" data-device="${d.id}">${d.name}</button>`).join("")}</div>
            <button class="fs-btn fs-close" type="button" aria-label="Close">Close</button></div>
          <div class="fs-list"></div>
        </div>
      </div>
    </div>
  </div>`);
  root.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const canvas = $(".fs-panel");
  const frame = $(".fs-frame");
  const stage = $(".fs-stage");
  const picker = $(".fs-picker");
  const tap = $(".fs-tap");

  let info = null, view = null;
  const catalogs = new Map(); // device -> { device, default, firmwares, byId }
  let pickerDevice = null; // the device whose firmwares the picker shows
  let defaultAsked = -1; // the choice for which the device's first firmware was asked for (once)
  let synth = null, synthLoading = null;
  let booted = -1; // the choice the emulator booted (or is booting)
  let bootedMhz = null;
  let reported = ""; // the last status sent, so the same one is not sent twice
  let aspect = 1280 / 820;
  let dead = false;

  const playerSeat = () => (view ? view.seat : null);
  /** This board plays the synth: the table's own board, for the player sitting at the table (controlSeats). */
  const plays = () => !!info && view && info.controlSeats?.includes(view.seat);

  function fit() {
    // the panel as large as the stage allows, keeping its shape
    const w = stage.clientWidth, h = stage.clientHeight;
    const s = Math.min(w / aspect, h);
    frame.style.width = `${Math.floor(s * aspect)}px`;
    frame.style.height = `${Math.floor(s)}px`;
  }

  async function loadCatalog(device) {
    if (catalogs.has(device)) return catalogs.get(device);
    const c = await (await fetch(ctx.assetUrl(`emu/firmwares-${device}.json`))).json();
    const cat = { device, ...c, byId: new Map(c.firmwares.map((f) => [f.id, f])) };
    catalogs.set(device, cat);
    return cat;
  }

  function report(state, text) {
    // (no "loading": the rules set it when a firmware is chosen; every report counts as a move in the statistics)
    if (!plays() || !view || state === "loading") return;
    const key = `${view.choice}|${state}|${text}`;
    if (key === reported) return;
    reported = key;
    ctx.act(playerSeat(), "status", { state, text, choice: view.choice });
  }

  async function ensureSynth() {
    if (synth) return synth;
    synthLoading ??= (async () => {
      const { Synth } = await import(ctx.assetUrl("synth.js"));
      const s = new Synth(canvas, {
        base: ctx.assetUrl(""),
        onStatus: (state, text) => {
          showTap();
          report(state, text);
        },
        onBoard: (b) => {
          aspect = s.W / s.H;
          box.dataset.board = b ? "smk37" : "fm1";
          fit();
        },
      });
      await s.init();
      if (dead) {
        s.destroy();
        return null;
      }
      synth = s;
      applyPrefs();
      return s;
    })();
    return synthLoading;
  }

  function showTap() {
    tap.hidden = !synth || synth.audible;
  }

  function applyPrefs() {
    if (!synth || !info) return;
    const p = prefsOf(info);
    synth.setVolume(p.volume / 100, info.sound === false);
    synth.flipped = info.rotation === 180;
  }

  async function boot(force = false) {
    if (!plays() || !view?.firmware) return;
    const mhz = prefsOf(info).mhz;
    if (!force && booted === view.choice && bootedMhz === mhz) return;
    booted = view.choice;
    bootedMhz = mhz;
    const c = await loadCatalog(view.device);
    const entry = c.byId.get(view.firmware);
    if (!entry) return report("error", `${view.firmwareName || view.firmware} is not in this game's list`);
    const s = await ensureSynth();
    if (!s) return;
    s.setBoard(view.device === "smk37" ? 1 : 0); // the device's panel at once (the package confirms it when it boots)
    await s.play(entry, mhz);
    showTap();
  }

  async function renderPicker() {
    const device = pickerDevice ?? view?.device ?? "fm1";
    for (const t of picker.querySelectorAll(".fs-tab")) t.setAttribute("aria-selected", String(t.dataset.device === device));
    const catalog = await loadCatalog(device);
    if (device !== (pickerDevice ?? view?.device ?? "fm1")) return; // another tab was tapped meanwhile
    const here = device === view?.device;
    $(".fs-sheet-title").textContent = `Firmwares for the ${deviceName(device)} (${catalog.firmwares.length})`;
    $(".fs-list").innerHTML = catalog.firmwares
      .map((f) => `<button type="button" class="fs-card ${here && view?.firmware === f.id ? "on" : ""}" data-id="${esc(f.id)}">
        <div class="fs-card-head"><b>${esc(f.name)}</b><span class="muted">${esc(f.version ?? "")}</span></div>
        <div class="fs-card-by muted">${esc(f.author ?? "")}</div>
        <div class="fs-card-about">${esc(f.about ?? "")}</div></button>`)
      .join("");
  }

  async function openPicker() {
    if (!plays()) return;
    pickerDevice = view.device;
    picker.hidden = false;
    await renderPicker();
    picker.querySelector(".fs-card.on")?.scrollIntoView({ block: "center" });
  }

  /** Switch the board to the other device, on that device's first firmware (the rules ask the board to name it). */
  function setDevice(device) {
    if (!plays() || !view || view.done || device === view.device || !DEVICES.some((d) => d.id === device)) return;
    ctx.act(playerSeat(), "device", { device });
  }

  $(".fs-pick").addEventListener("click", openPicker);
  $(".fs-close").addEventListener("click", () => (picker.hidden = true));
  picker.addEventListener("click", (e) => {
    if (e.target === picker) picker.hidden = true;
  });
  // A tab switches the board to that device at once, on its first firmware, as the phone's buttons do (E-011); the
  // window stays open on that device's list, to pick another.
  picker.querySelector(".fs-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".fs-tab");
    if (!tab) return;
    const device = tab.dataset.device;
    if (device !== pickerDevice) {
      pickerDevice = device;
      $(".fs-list").scrollTop = 0;
      renderPicker();
    }
    setDevice(device);
  });
  $(".fs-list").addEventListener("click", async (e) => {
    const card = e.target.closest(".fs-card");
    const device = pickerDevice ?? view?.device;
    const catalog = catalogs.get(device);
    if (!card || !catalog) return;
    picker.hidden = true;
    const f = catalog.byId.get(card.dataset.id);
    if (!f || (f.id === view?.firmware && device === view?.device)) return;
    await ctx.act(playerSeat(), "firmware", { id: f.id, name: f.name, device });
  });
  $(".fs-restart").addEventListener("click", () => boot(true));
  // a tap anywhere on the board wakes the sound where the browser waits for one
  const wake = () => {
    synth?.resume()?.then(showTap);
  };
  box.addEventListener("pointerdown", wake);

  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  const inst = {
    openPicker,
    setDevice,
    device: () => (plays() && view && !view.done ? view.device : null),
    restart: () => boot(true),
    update(v, _events, i) {
      view = v;
      info = i;
      // the player's plate turns with the game too, in place on South (E-008)
      seatPlates(root, info).classList.toggle("fs-plates-north", info.rotation === 180);
      const local = plays();
      box.classList.toggle("fs-remote", !local);
      // Facing north (the board's turn button): each part turns in place to face that reader, and stays where it is:
      // the bar on the north edge, the panel in the middle, the seat plate and the platform's buttons on the south
      // edge (a single player's game keeps its plate; E-007).
      box.classList.toggle("fs-north", info.rotation === 180);
      const dev = deviceName(v.device);
      $(".fs-name").textContent = v.firmwareName ? `${dev} · ${v.firmwareName}` : `M-VAVE ${dev}`;
      $(".fs-status").textContent = v.done ? "Done" : v.status.text || (v.firmware ? "" : "Choosing a firmware…");
      $(".fs-dot").dataset.state = v.done ? "idle" : v.status.state;
      $(".fs-actions").hidden = !local || v.done;
      const away = $(".fs-away");
      frame.hidden = !local;
      away.hidden = local;
      if (!local) {
        const me = info.players.find((p) => p.seat === v.seat);
        away.innerHTML = `<div class="fs-away-box"><div class="fs-away-title">The synth plays on the table's own screen</div>
          <div class="muted">${esc(me?.name ?? "The player")} plays the ${dev} there${v.firmwareName ? `: ${esc(v.firmwareName)}` : ""}. Its sound stays at the table.</div></div>`;
        return;
      }
      applyPrefs();
      if (v.done) {
        synth?.flush(true);
        return;
      }
      loadCatalog(v.device).then((c) => {
        // the first firmware: the device's default, chosen for the player (the phone or the board changes it)
        if (dead || c.device !== view.device) return; // (the device changed while its list loaded)
        if (!view.firmware) {
          if (defaultAsked === view.choice) return; // asked already; the answer is on its way
          defaultAsked = view.choice;
          const f = c.byId.get(c.default) ?? c.firmwares[0];
          if (f) ctx.act(playerSeat(), "firmware", { id: f.id, name: f.name, device: c.device });
          return;
        }
        if (picker.hidden === false) {
          // the window shows the device the board has, also when the phone switched it meanwhile
          if (pickerDevice !== view.device) {
            pickerDevice = view.device;
            $(".fs-list").scrollTop = 0;
          }
          renderPicker();
        }
        boot();
      });
    },
    destroy() {
      dead = true;
      ro.disconnect();
      if (live === inst) live = null;
      synth?.destroy();
      box.remove();
    },
  };
  live = inst;
  return inst;
}
