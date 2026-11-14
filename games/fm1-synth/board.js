// FM-1 Synth on the board: the emulated device's front panel, played by touch, a slim bar above it (the firmware,
// how it runs, a firmware picker) and the platform's seat plate below. The emulator runs only on the table's own board
// for the player sitting at it (E-002); a remote board (a watcher) shows the bar and a note instead.
import { esc, html, seatPlates, useStyles } from "/shared/board-kit.js";
import { DEVICES, deviceName, loadCatalog as fetchCatalog, loadedCatalog, orderedIds } from "/games/fm1-synth/assets/catalog.js";

const ID = "fm1-synth";
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
          <div class="fs-sheet-head"><div><div class="fs-sheet-title"></div><div class="fs-sheet-sub muted">Tap one to play it. It is downloaded from its author's site. Starred ones come first, kept on your phone.</div></div>
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
  let pickerDevice = null; // the device whose firmwares the picker shows
  let pickerOrder = null; // { device, ids }: the order of the window's list, fixed while it is open (E-013)
  let pickerRows = ""; // the window's list as drawn
  const redrawn = new Set(); // devices whose list is drawn again once their packages are checked
  const shown = () => pickerDevice ?? view?.device ?? "fm1";
  let defaultAsked = -1; // the choice for which the device's first firmware was asked for (once)
  // Firmwares whose package could not be downloaded on this board (`device/id`), the choice the board made itself (a
  // device's first firmware, or the next one when that is not available), and the firmwares it passed over for it.
  const unavailable = new Set();
  let autoChoice = -1;
  let skipped = [];
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

  const loadCatalog = (device) => fetchCatalog(ctx.assetUrl, device);

  function report(state, text) {
    // (no "loading": the rules set it when a firmware is chosen; every report counts as a move in the statistics)
    if (!plays() || !view || state === "loading") return;
    const key = `${view.choice}|${state}|${text}`;
    if (key === reported) return;
    reported = key;
    ctx.act(playerSeat(), "status", { state, text, choice: view.choice });
  }

  /**
   * The board's own choice of a firmware for the device: its first, or the next in the list when one's package is gone
   * (its site says so, E-016) or could not be downloaded here (E-015).
   */
  async function chooseFor(c) {
    const choice = view.choice;
    for (const f of [c.byId.get(c.default), ...c.firmwares]) {
      if (!f || unavailable.has(`${c.device}/${f.id}`) || (await c.check(f.id)) === "gone") continue;
      if (dead || view.choice !== choice) return; // (chosen otherwise meanwhile)
      autoChoice = choice + 1;
      return ctx.act(playerSeat(), "firmware", { id: f.id, name: f.name, device: c.device });
    }
    report("error", `No firmware for the ${deviceName(c.device)} can be downloaded right now. Check the table's internet connection.`);
  }

  /** How the firmware runs, from the synth: an unavailable package the board chose itself makes way for the next. */
  function status(state, text, problem) {
    const key = `${view?.device}/${view?.firmware}`;
    if (state === "running") {
      unavailable.delete(key);
      if (booted === autoChoice && skipped.length) text += ` (${skipped.join(", ")} can't be downloaded right now)`;
    }
    if (state === "error" && problem?.unavailable) {
      unavailable.add(key);
      if (!picker.hidden) renderPicker();
      const c = loadedCatalog(view.device);
      if (booted === autoChoice && c && !view.done) {
        skipped.push(view.firmwareName || view.firmware);
        return chooseFor(c);
      }
      text += ". Pick another firmware, or tap it again to try once more.";
    }
    report(state, text);
  }

  async function ensureSynth() {
    if (synth) return synth;
    synthLoading ??= (async () => {
      const { Synth } = await import(ctx.assetUrl("synth.js"));
      const s = new Synth(canvas, {
        base: ctx.assetUrl(""),
        onStatus: (state, text, problem) => {
          showTap();
          status(state, text, problem);
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
    let entry, s;
    try {
      entry = (await loadCatalog(view.device)).byId.get(view.firmware);
      if (!entry) return report("error", `${view.firmwareName || view.firmware} is not in this game's list`);
      s = await ensureSynth();
    } catch (e) {
      booted = -1; // (Restart tries again)
      return report("error", `The synth could not start: ${e.message}`);
    }
    if (!s) return;
    s.setBoard(view.device === "smk37" ? 1 : 0); // the device's panel at once (the package confirms it when it boots)
    await s.play(entry, mhz);
    showTap();
  }

  async function renderPicker() {
    const device = shown();
    for (const t of picker.querySelectorAll(".fs-tab")) t.setAttribute("aria-selected", String(t.dataset.device === device));
    let catalog;
    try {
      catalog = await loadCatalog(device);
    } catch (e) {
      if (device !== shown()) return;
      $(".fs-sheet-title").textContent = `Firmwares for the ${deviceName(device)}`;
      $(".fs-list").innerHTML = pickerRows = `<div class="fs-empty muted">The ${esc(deviceName(device))}'s firmware list could not be loaded (${esc(e.message)}). Close the window and open it again to try once more.</div>`;
      return;
    }
    if (device !== shown()) return; // another tab was tapped meanwhile
    if (!redrawn.has(device)) {
      redrawn.add(device);
      catalog.checked.then(() => !picker.hidden && shown() === device && renderPicker());
    }
    const here = device === view?.device;
    // the order is taken when the window opens on a device, so a star does not move the card under the finger
    if (pickerOrder?.device !== device) pickerOrder = { device, ids: orderedIds(catalog, view?.favorites?.[device]) };
    const stars = new Set(view?.favorites?.[device] ?? []);
    const firmwares = pickerOrder.ids.filter((id) => !catalog.gone.has(id)).map((id) => catalog.byId.get(id));
    $(".fs-sheet-title").textContent = `Firmwares for the ${deviceName(device)} (${firmwares.length})`;
    const rows = firmwares
      .map((f) => {
        const on = stars.has(f.id);
        const gone = unavailable.has(`${device}/${f.id}`);
        return `<div role="button" class="fs-card ${here && view?.firmware === f.id ? "on" : ""} ${gone ? "gone" : ""}" data-id="${esc(f.id)}">
        <div class="fs-card-head"><b>${esc(f.name)}</b><span class="muted">${esc(f.version ?? "")}</span>
          <button type="button" class="fs-star ${on ? "starred" : ""}" aria-pressed="${on}" aria-label="${on ? "Remove the star" : "Star it"}">${on ? "★" : "☆"}</button></div>
        <div class="fs-card-by muted">${esc(f.author ?? "")}</div>
        <div class="fs-card-about">${gone ? "Can't be downloaded right now. Tap to try again." : esc(f.about ?? "")}</div></div>`;
      })
      .join("");
    const list = $(".fs-list");
    if (rows !== pickerRows) list.innerHTML = pickerRows = rows;
  }

  /** The window on a device's list: its order taken anew, from the top. */
  function showDevice(device) {
    pickerDevice = device;
    pickerOrder = null;
    $(".fs-list").scrollTop = 0;
  }

  async function openPicker() {
    if (!plays()) return;
    showDevice(view.device);
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
      showDevice(device);
      renderPicker();
    }
    setDevice(device);
  });
  $(".fs-list").addEventListener("click", async (e) => {
    const card = e.target.closest(".fs-card");
    const device = shown();
    const catalog = loadedCatalog(device);
    if (!card || !catalog) return;
    const star = e.target.closest(".fs-star");
    if (star) {
      // a star on or off; the window stays open
      if (!view || view.done) return;
      await ctx.act(playerSeat(), "star", { device, id: card.dataset.id, on: star.getAttribute("aria-pressed") !== "true" });
      return;
    }
    picker.hidden = true;
    const f = catalog.byId.get(card.dataset.id);
    if (!f) return;
    if (f.id === view?.firmware && device === view?.device) {
      if (view.status.state === "error") boot(true); // the chosen one again, after it failed: try once more
      return;
    }
    await ctx.act(playerSeat(), "firmware", { id: f.id, name: f.name, device });
  });
  /** Restart: the firmware again, or, when none could be chosen yet (no list), the device's first again. */
  function restart() {
    if (!view || view.done) return;
    if (view.firmware) return boot(true);
    defaultAsked = -1;
    inst.update(view, [], info);
  }
  $(".fs-restart").addEventListener("click", restart);
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
    restart,
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
          skipped = [];
          chooseFor(c);
          return;
        }
        if (picker.hidden === false) {
          // the window shows the device the board has, also when the phone switched it meanwhile
          if (pickerDevice !== view.device) showDevice(view.device);
          renderPicker();
        }
        boot();
      }, (e) => report("error", `The ${deviceName(v.device)}'s firmware list could not be loaded (${e.message}). Tap Restart to try again.`));
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
