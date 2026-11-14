// FM-1 Synth on the player's phone: what plays on the board and how it runs, the firmwares to switch to, and Finish.
// The synth itself is played on the board (E-003). The player's starred firmwares live in this phone's browser
// between games: sent to the game once, kept up to date from it (E-013).
import { esc, useStyles } from "/shared/board-kit.js";
import { DEVICES, deviceName, loadCatalog, noFavorites, orderedIds } from "/games/fm1-synth/assets/catalog.js";

const STORE = "fm1-synth.favorites";

/** Each device's list of ids, from whatever was stored. */
const clean = (v) => Object.fromEntries(DEVICES.map(({ id: d }) => [d, Array.isArray(v?.[d]) ? v[d].filter((x) => typeof x === "string") : []]));

function stored() {
  try {
    return clean(JSON.parse(localStorage.getItem(STORE) ?? "null"));
  } catch {
    return noFavorites();
  }
}

function store(favorites) {
  try {
    localStorage.setItem(STORE, JSON.stringify(clean(favorites)));
  } catch {
    // (private browsing, or storage blocked: the stars last for this game only)
  }
}

export function mount(root, ctx) {
  useStyles("/games/fm1-synth/deck.css");
  root.innerHTML = `<div class="fd">
    <div class="card fd-now"><div class="eyebrow fd-dev"></div><div class="fd-name"></div>
      <div class="fd-status"><span class="fd-dot"></span><span class="fd-text"></span></div></div>
    <div class="fd-devices">${DEVICES.map((d) => `<button type="button" class="fd-dev-btn" data-device="${d.id}">${d.name}</button>`).join("")}</div>
    <div class="fd-hint muted">Play the synth on the board. Pick another firmware here or on the board. Starred ones come first.</div>
    <div class="fd-list"></div>
    <button type="button" class="fd-finish">Finish</button>
    <div class="fd-confirm" hidden><div class="fd-confirm-text">End the session? It can't be continued; the board offers Play again.</div>
      <div class="fd-confirm-btns"><button type="button" class="primary fd-keep">Keep playing</button><button type="button" class="fd-end">Finish</button></div></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, catalog = null, device = null;
  let sent = false; // this phone's stars went to the game
  let order = null; // { synced, catalog, ids }: the list's order, taken when the device's list or the stars arrive
  let rows = ""; // the list as drawn

  let failed = false; // the device's list could not be loaded (asked again in a few seconds)
  let retry = null;

  async function load(dev) {
    if (device === dev && !failed) return;
    device = dev;
    failed = false;
    try {
      const c = await loadCatalog(ctx.assetUrl, dev);
      if (device === dev) catalog = c; // (not when another device was chosen meanwhile)
    } catch {
      if (device === dev) {
        failed = true;
        clearTimeout(retry);
        retry = setTimeout(() => view && load(view.device), 5000);
      }
    }
    draw();
  }

  /** The list's place says something instead of rows: while it loads, or when it could not be loaded. */
  function note(text) {
    const html = `<div class="fd-note muted">${esc(text)}</div>`;
    if (html !== rows) $(".fd-list").innerHTML = rows = html;
  }

  function draw() {
    if (!view) return;
    // only the list of the device the board has: a tap on it chooses for that device
    if (failed) return note(`The ${deviceName(view.device)}'s firmware list could not be loaded. Trying again…`);
    if (catalog?.device !== view.device) return note("Loading the firmware list…");
    const stars = view.favorites?.[catalog.device] ?? [];
    // starred first, newest star first; a star given here moves the row only the next time
    if (order?.synced !== view.favSynced || order.catalog !== catalog) order = { synced: view.favSynced, catalog, ids: orderedIds(catalog, stars) };
    const html = order.ids
      .map((id) => catalog.byId.get(id))
      .filter(Boolean)
      .map((f) => {
        const on = stars.includes(f.id);
        return `<div class="fd-row"><button type="button" class="fd-fw ${f.id === view.firmware ? "on" : ""}" data-id="${esc(f.id)}" data-name="${esc(f.name)}"
        ${view.done ? "disabled" : ""}><b>${esc(f.name)}</b><span>${esc(f.author ?? "")}</span></button>
        <button type="button" class="fd-star ${on ? "starred" : ""}" data-id="${esc(f.id)}" aria-pressed="${on}" aria-label="${on ? "Remove the star" : "Star it"}"
        ${view.done ? "disabled" : ""}>${on ? "★" : "☆"}</button></div>`;
      })
      .join("");
    if (html !== rows) $(".fd-list").innerHTML = rows = html;
  }

  $(".fd-list").addEventListener("click", (e) => {
    const star = e.target.closest(".fd-star");
    if (star) {
      if (view && !view.done) ctx.send("star", { device: catalog.device, id: star.dataset.id, on: star.getAttribute("aria-pressed") !== "true" });
      return;
    }
    const b = e.target.closest(".fd-fw");
    if (!b || !view || view.done || b.dataset.id === view.firmware) return;
    // (the device of the list it came from: the board may have switched while this list was shown)
    ctx.send("firmware", { id: b.dataset.id, name: b.dataset.name, device: catalog.device });
  });
  root.querySelectorAll(".fd-dev-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (view && !view.done && b.dataset.device !== view.device) ctx.send("device", { device: b.dataset.device });
    }),
  );
  // Finish ends the game for good (the platform has no way back into it), so it asks first.
  const confirming = (on) => {
    $(".fd-finish").hidden = on;
    $(".fd-confirm").hidden = !on;
  };
  $(".fd-finish").addEventListener("click", () => confirming(true));
  $(".fd-keep").addEventListener("click", () => confirming(false));
  $(".fd-end").addEventListener("click", () => {
    confirming(false);
    ctx.send("finish", {});
  });

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
      $(".fd-dev").textContent = `M-VAVE ${deviceName(v.device)}`;
      $(".fd-name").textContent = v.firmwareName || "Choosing a firmware…";
      $(".fd-text").textContent = v.done ? "Done" : v.status.text || "";
      $(".fd-dot").dataset.state = v.status.state;
      $(".fd-finish").disabled = v.done;
      if (v.done) confirming(false);
      root.querySelectorAll(".fd-dev-btn").forEach((b) => {
        b.classList.toggle("on", b.dataset.device === v.device);
        b.disabled = v.done;
      });
      load(v.device);
      draw();
    },
    destroy() {
      clearTimeout(retry);
    },
  };
}
