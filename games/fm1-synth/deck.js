// FM-1 Synth on the player's phone: what plays on the board and how it runs, the firmwares to switch to, and Finish.
// The synth itself is played on the board (E-003).
import { esc, useStyles } from "/shared/board-kit.js";

export function mount(root, ctx) {
  useStyles("/games/fm1-synth/deck.css");
  root.innerHTML = `<div class="fd">
    <div class="card fd-now"><div class="eyebrow fd-dev"></div><div class="fd-name"></div>
      <div class="fd-status"><span class="fd-dot"></span><span class="fd-text"></span></div></div>
    <div class="fd-devices"><button type="button" class="fd-dev-btn" data-device="fm1">FM-1</button><button type="button" class="fd-dev-btn" data-device="smk37">SMK-37</button></div>
    <div class="fd-hint muted">Play the synth on the board. Pick another firmware here or on the board.</div>
    <div class="fd-list"></div>
    <button type="button" class="fd-finish">Finish</button>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, catalog = null, device = null;

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
    if (!view) return;
    const list = $(".fd-list");
    const rows = (catalog?.firmwares ?? [])
      .map((f) => `<button type="button" class="fd-fw ${f.id === view.firmware ? "on" : ""}" data-id="${esc(f.id)}" data-name="${esc(f.name)}"
        ${view.done ? "disabled" : ""}><b>${esc(f.name)}</b><span>${esc(f.author ?? "")}</span></button>`)
      .join("");
    if (list.dataset.rows !== rows) {
      list.dataset.rows = rows;
      list.innerHTML = rows;
    }
  }

  $(".fd-list").addEventListener("click", (e) => {
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
