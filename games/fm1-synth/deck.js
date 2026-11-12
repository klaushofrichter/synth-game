// FM-1 Synth on the player's phone: what plays on the board and how it runs, the firmwares to switch to, and Finish.
// The synth itself is played on the board (E-003). The player's starred firmwares live in this phone's browser
// between games: sent to the game once, kept up to date from it (E-013).
import { esc, useStyles } from "/shared/board-kit.js";

const STORE = "fm1-synth.favorites";
const DEVICES = ["fm1", "smk37"];

function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return Object.fromEntries(DEVICES.map((d) => [d, Array.isArray(v?.[d]) ? v[d].filter((x) => typeof x === "string") : []]));
  } catch {
    return { fm1: [], smk37: [] };
  }
}

function store(favorites) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ fm1: favorites.fm1 ?? [], smk37: favorites.smk37 ?? [] }));
  } catch {
    // (private browsing, or storage blocked: the stars last for this game only)
  }
}

export function mount(root, ctx) {
  useStyles("/games/fm1-synth/deck.css");
  root.innerHTML = `<div class="fd">
    <div class="card fd-now"><div class="eyebrow fd-dev"></div><div class="fd-name"></div>
      <div class="fd-status"><span class="fd-dot"></span><span class="fd-text"></span></div></div>
    <div class="fd-devices"><button type="button" class="fd-dev-btn" data-device="fm1">FM-1</button><button type="button" class="fd-dev-btn" data-device="smk37">SMK-37</button></div>
    <div class="fd-hint muted">Play the synth on the board. Pick another firmware here or on the board. Starred ones come first.</div>
    <div class="fd-list"></div>
    <button type="button" class="fd-finish">Finish</button>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, catalog = null, device = null;
  let sent = false; // this phone's stars went to the game
  let order = null; // { device, synced, catalog, ids }: the list's order, taken when the device or the stars arrive

  async function load(dev) {
    if (device === dev) return;
    device = dev;
    try {
      catalog = await (await fetch(ctx.assetUrl(`emu/firmwares-${dev}.json`))).json();
    } catch {
      catalog = { firmwares: [] };
    }
    draw();
  }

  function draw() {
    if (!view || !catalog) return;
    const list = $(".fd-list");
    const stars = view.favorites?.[device] ?? [];
    if (order?.device !== device || order.synced !== view.favSynced || order.catalog !== catalog) {
      // starred first, newest star first; a star given here moves the row only the next time
      const known = new Set(catalog.firmwares.map((f) => f.id));
      const first = stars.filter((id) => known.has(id));
      order = { device, synced: view.favSynced, catalog,
        ids: [...first, ...catalog.firmwares.map((f) => f.id).filter((id) => !first.includes(id))] };
    }
    const byId = new Map(catalog.firmwares.map((f) => [f.id, f]));
    const rows = order.ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((f) => {
        const on = stars.includes(f.id);
        return `<div class="fd-row"><button type="button" class="fd-fw ${f.id === view.firmware ? "on" : ""}" data-id="${esc(f.id)}" data-name="${esc(f.name)}"
        ${view.done ? "disabled" : ""}><b>${esc(f.name)}</b><span>${esc(f.author ?? "")}</span></button>
        <button type="button" class="fd-star ${on ? "starred" : ""}" data-id="${esc(f.id)}" aria-pressed="${on}" aria-label="${on ? "Remove the star" : "Star it"}"
        ${view.done ? "disabled" : ""}>${on ? "★" : "☆"}</button></div>`;
      })
      .join("");
    if (list.dataset.rows !== rows) {
      list.dataset.rows = rows;
      list.innerHTML = rows;
    }
  }

  $(".fd-list").addEventListener("click", (e) => {
    const star = e.target.closest(".fd-star");
    if (star) {
      if (view && !view.done) ctx.send("star", { device, id: star.dataset.id, on: star.getAttribute("aria-pressed") !== "true" });
      return;
    }
    const b = e.target.closest(".fd-fw");
    if (!b || !view || view.done || b.dataset.id === view.firmware) return;
    // (the device of the list it came from: the board may have switched while this list was shown)
    ctx.send("firmware", { id: b.dataset.id, name: b.dataset.name, device });
  });
  root.querySelectorAll(".fd-dev-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (view && !view.done && b.dataset.device !== view.device) ctx.send("device", { device: b.dataset.device });
    }),
  );
  $(".fd-finish").addEventListener("click", () => ctx.send("finish", {}));

  return {
    update(v) {
      view = v;
      if (!v.favSynced) {
        // the game has no stars of this player yet (a new game, or another player took the seat): send this phone's
        if (!sent && !v.done) {
          sent = true;
          ctx.send("favorites", { list: stored() });
        }
      } else if (v.favorites) {
        sent = false; // (sent again if the seat changes hands)
        store(v.favorites);
      }
      $(".fd-dev").textContent = v.device === "smk37" ? "M-VAVE SMK-37" : "M-VAVE FM-1";
      $(".fd-name").textContent = v.firmwareName || "Choosing a firmware…";
      $(".fd-text").textContent = v.done ? "Done" : v.status.text || "";
      $(".fd-dot").dataset.state = v.status.state;
      $(".fd-finish").disabled = v.done;
      root.querySelectorAll(".fd-dev-btn").forEach((b) => {
        b.classList.toggle("on", b.dataset.device === v.device);
        b.disabled = v.done;
      });
      load(v.device);
      draw();
    },
    destroy() {},
  };
}
