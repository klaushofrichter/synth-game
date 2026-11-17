// FM-1 Synth on the board: the emulated device's front panel, played by touch, a slim bar above it (the firmware,
// how it runs, a firmware picker) and the platform's seat plate below. The emulator runs only on the table's own board
// for the player sitting at it (E-002); a remote board (a watcher) shows the bar and a note instead.
import { esc, html, seatPlates, useStyles } from "/shared/board-kit.js";
import { DEVICES, cleanLists, deviceName, loadCatalog as fetchCatalog, loadedCatalog, orderedIds } from "/games/fm1-synth/assets/catalog.js";

const ID = "fm1-synth";
const CLOCKS = [60, 80, 100, 120, 160, 200, 240];
const VOLUMES = [0, 20, 40, 60, 80, 100];
const prefsOf = (info) => ({
  volume: VOLUMES.includes(info?.prefs?.volume) ? info.prefs.volume : 80,
  mhz: CLOCKS.includes(info?.prefs?.mhz) ? info.prefs.mhz : 100,
});

/** The mounted board, for the settings window's buttons. */
let live = null;
/** The emulator's version (upstream fm1-emu's, from emu/build.json), once the board has read it. */
let emuVersion = null;

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
    ...(emuVersion ? [{ type: "text", label: "Emulator", value: `fm1-emu ${emuVersion}` }] : []),
  ];
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/board.css`);
  if (!emuVersion)
    fetch(ctx.assetUrl("emu/build.json"))
      .then((r) => r.json())
      .then((b) => (emuVersion = b.version ?? null))
      .catch(() => {});
  const box = html(`<div class="fs-root">
    <div class="fs-game">
      <div class="fs-bar">
        <div class="fs-now"><span class="fs-dot"></span><div><div class="fs-name"></div><div class="fs-line"><span class="fs-status"></span><span class="fs-perf" hidden></span></div></div></div>
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
          <div class="fs-body"><div class="fs-list"></div><div class="fs-scroll" hidden><div class="fs-thumb"></div></div></div>
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
  const perf = $(".fs-perf");

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
        onPerf: showPerf,
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

  /** How the emulator keeps up on this board (only here: it is this computer's, not the game's): red at 1x or below. */
  function showPerf({ speed, load }) {
    if (view?.status.state !== "running" || view.done) return;
    perf.textContent = `${speed.toFixed(speed < 10 ? 1 : 0)}x real time · load ${Math.round(100 * load)}%`;
    perf.classList.toggle("fs-slow", speed <= 1);
    perf.hidden = false;
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
    if (pickerOrder?.device !== device) pickerOrder = { device, ids: orderedIds(catalog, view?.favorites?.[device], view?.unliked?.[device]) };
    const stars = new Set(view?.favorites?.[device] ?? []);
    const downs = new Set(view?.unliked?.[device] ?? []);
    const firmwares = pickerOrder.ids.filter((id) => !catalog.gone.has(id)).map((id) => catalog.byId.get(id));
    $(".fs-sheet-title").textContent = `Firmwares for the ${deviceName(device)} (${firmwares.length})`;
    const rows = firmwares
      .map((f) => {
        const on = stars.has(f.id);
        const gone = unavailable.has(`${device}/${f.id}`);
        const down = downs.has(f.id);
        return `<div role="button" class="fs-card ${here && view?.firmware === f.id ? "on" : ""} ${gone ? "gone" : ""} ${down ? "unliked" : ""}" data-id="${esc(f.id)}">
        <div class="fs-card-head"><b>${esc(f.name)}</b>
          <button type="button" class="fs-unlike ${down ? "on" : ""}" aria-pressed="${down}" aria-label="${down ? "Take the unlike off" : "Unlike it"}">👎</button>
          <button type="button" class="fs-star ${on ? "starred" : ""}" aria-pressed="${on}" aria-label="${on ? "Remove the star" : "Star it"}">${on ? "★" : "☆"}</button></div>
        <div class="fs-card-by muted">${esc([f.author, f.version].filter(Boolean).join(" · "))}</div>
        <div class="fs-card-about">${gone ? "Can't be downloaded right now. Tap to try again." : esc(f.about ?? "")}</div></div>`;
      })
      .join("");
    const list = $(".fs-list");
    if (rows !== pickerRows) list.innerHTML = pickerRows = rows;
    scroller.update();
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
    scroller.update();
  }

  /** Switch the board to the other device, on that device's first firmware (the rules ask the board to name it). */
  function setDevice(device) {
    if (!plays() || !view || view.done || device === view.device || !DEVICES.some((d) => d.id === device)) return;
    ctx.act(playerSeat(), "device", { device });
  }

  // The stars and unlikes are the table's (E-020): kept in its game data between games, shared by everyone who plays
  // here. The board that plays brings them to the game once, then keeps the table's copy in step with the game's. On a
  // table without game data (an older platform) the phone keeps its own, as before (E-013).
  let tableAsked = false;
  let tableHas = null; // the table's copy of each list, as JSON
  async function syncTable() {
    if (!ctx.store || !plays() || !view || view.done) return;
    if (!view.shared) {
      if (tableAsked) return;
      tableAsked = true;
      const list = cleanLists(await ctx.store.get("favorites"));
      const unliked = cleanLists(await ctx.store.get("unliked"));
      tableHas = { favorites: JSON.stringify(list), unliked: JSON.stringify(unliked) };
      const r = await ctx.act(playerSeat(), "favorites", { list, unliked, shared: true });
      if (!r?.ok) tableAsked = false; // (asked again with the next update)
      return;
    }
    for (const key of ["favorites", "unliked"]) {
      const now = JSON.stringify(view[key]);
      if (now === tableHas?.[key]) continue;
      (tableHas ??= {})[key] = now;
      ctx.store.set(key, view[key]);
    }
  }

  const scroller = dragScroll($(".fs-list"), $(".fs-scroll"), () => (box.classList.contains("fs-north") ? -1 : 1));
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
    const star = e.target.closest(".fs-star, .fs-unlike");
    if (star) {
      // a star or an unlike, on or off; the window stays open
      if (!view || view.done) return;
      await ctx.act(playerSeat(), star.classList.contains("fs-star") ? "star" : "unlike", { device, id: card.dataset.id, on: star.getAttribute("aria-pressed") !== "true" });
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
      syncTable();
      box.classList.toggle("fs-remote", !local);
      // Facing north (the board's turn button): each part turns in place to face that reader, and stays where it is:
      // the bar on the north edge, the panel in the middle, the seat plate and the platform's buttons on the south
      // edge (a single player's game keeps its plate; E-007).
      box.classList.toggle("fs-north", info.rotation === 180);
      const dev = deviceName(v.device);
      $(".fs-name").textContent = v.firmwareName ? `${dev} · ${v.firmwareName}` : `M-VAVE ${dev}`;
      $(".fs-status").textContent = v.done ? "Done" : v.status.text || (v.firmware ? "" : "Choosing a firmware…");
      $(".fs-dot").dataset.state = v.done ? "idle" : v.status.state;
      if (v.done || v.status.state !== "running") perf.hidden = true;
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

/**
 * The firmware list scrolls by dragging it and by a wide bar of its own (E-019), with any pointer: a table's
 * touchscreen may reach the browser as a mouse, and the browser's own bar is too thin to hit with a finger. A drag that
 * moved is not a tap (no firmware chosen); a flick runs on and slows down. `turned()` is -1 while the window is turned
 * to face north. Returns { update() }: the bar follows the list's size (after the list is drawn anew).
 */
function dragScroll(list, bar, turned) {
  const thumb = bar.firstElementChild;
  const MOVE = 12; // px a press may wander and still be a tap
  /** Screen pixels to the list's own, along its height (the board is scaled to the screen, and may be turned). */
  const factor = (el) => {
    const r = el.getBoundingClientRect();
    return (el.offsetHeight && r.height ? el.offsetHeight / r.height : 1) * turned();
  };
  const room = () => list.scrollHeight - list.clientHeight;
  let fling = 0;
  const stop = () => cancelAnimationFrame(fling);

  function update() {
    const over = room() > 1;
    bar.hidden = !over;
    if (!over) return;
    const track = bar.clientHeight;
    const h = Math.max(90, (track * list.clientHeight) / list.scrollHeight);
    thumb.style.height = `${h}px`;
    thumb.style.transform = `translateY(${((track - h) * list.scrollTop) / room()}px)`;
  }
  list.addEventListener("scroll", update, { passive: true });

  // dragging the list itself
  let drag = null, dragged = false;
  list.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || drag) return;
    stop();
    dragged = false;
    drag = { id: e.pointerId, y: e.clientY, top: list.scrollTop, k: factor(list), last: e.clientY, t: e.timeStamp, v: 0 };
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y) * drag.k;
    if (!dragged && Math.abs(dy) < MOVE) return;
    if (!dragged) {
      dragged = true;
      list.setPointerCapture?.(e.pointerId);
    }
    list.scrollTop = drag.top - dy;
    const dt = e.timeStamp - drag.t;
    if (dt > 0) drag.v = (0.8 * (e.clientY - drag.last) * drag.k) / dt + 0.2 * drag.v;
    drag.last = e.clientY;
    drag.t = e.timeStamp;
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    let v = dragged && e.timeStamp - drag.t < 100 ? drag.v : 0; // (px per ms; a drag that paused does not run on)
    drag = null;
    let t = performance.now();
    const run = (now) => {
      list.scrollTop -= v * (now - t);
      v *= Math.pow(0.995, now - t);
      t = now;
      if (Math.abs(v) > 0.02) fling = requestAnimationFrame(run);
    };
    if (Math.abs(v) > 0.1) fling = requestAnimationFrame(run);
  };
  list.addEventListener("pointerup", release);
  list.addEventListener("pointercancel", release);
  // a drag is not a tap on the card it started on
  list.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );

  // the bar: drag its thumb, or tap the track above or below it for a page
  let grab = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    stop();
    e.preventDefault();
    if (e.target === thumb) {
      const ratio = room() / Math.max(1, bar.clientHeight - thumb.offsetHeight);
      grab = { id: e.pointerId, y: e.clientY, top: list.scrollTop, k: factor(bar) * ratio };
      bar.setPointerCapture?.(e.pointerId);
      return;
    }
    const r = thumb.getBoundingClientRect();
    const below = (e.clientY > r.bottom) === turned() > 0;
    list.scrollTop += (below ? 1 : -1) * 0.9 * list.clientHeight;
  });
  bar.addEventListener("pointermove", (e) => {
    if (grab && e.pointerId === grab.id) list.scrollTop = grab.top + (e.clientY - grab.y) * grab.k;
  });
  const letGo = (e) => grab && e.pointerId === grab.id && (grab = null);
  bar.addEventListener("pointerup", letGo);
  bar.addEventListener("pointercancel", letGo);

  return { update };
}
