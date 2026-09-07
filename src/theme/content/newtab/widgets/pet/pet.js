/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Pet widget (aesthetic, animated). Shows a looping pixel pet -- either a
 * specific one you pick, or "Random", which re-rolls on every render: a new
 * tab, a home-page refresh, or a click on the tile.
 *
 * ART SLOTS: every pet is one entry in assets/pets.json plus its PNG frames in
 * assets/. Adding a pet never means editing this file:
 *
 *   { "id": "cat", "name": "Cat", "frames": ["cat.png"] }
 *
 *   frames   one or more PNGs, each a single frame at NATIVE pixel size. Frames
 *            can be any size -- 16x24, 32x32, 56x62, 64x64 all ship today. The
 *            widget scales each pet up by an INTEGER factor to fill the tile
 *            (pixelated, so it stays crisp), so never pre-scale the art.
 *   mode     omitted: a single frame plays a gentle idle bob; several frames
 *            play in order at `fps`.
 *            "glitch": frames play in a RANDOM order, reshuffled every pass,
 *            with a pixel of jitter -- and the pet's name flickers into
 *            gibberish wherever it is shown (tile label and the ⚙ dropdown).
 *   action   "feature-request": the sprite becomes a real button that opens
 *            the feature-request form (rishi-request.js, loaded on demand).
 *   hint     tooltip for an actionable pet.
 *
 * Everything lives inside this closure: widget scripts are plain <script>
 * elements sharing ONE global scope (see widgets.js loadWidgetScripts), so a
 * top-level name here would collide with any other widget using the same one.
 */
(function () {
  "use strict";

  const ASSET_BASE = "chrome://cthulhu/content/newtab/widgets/pet/";
  const MAX_SCALE = 8;

  /* ------------------------------------------------------------------------
   * Glitch text: "KIY" <-> gibberish.
   *
   * Deliberately NOT English: a pinch of Greek, Cyrillic, Hebrew, katakana,
   * runes and block glyphs, plus the real letters so they surface mid-flicker.
   * The real name shows on ~40% of ticks so it stays readable as a whole.
   * ---------------------------------------------------------------------- */
  const JUMBLE =
    "KIYΨΩΔΘΞΣΦЖЗДЯЩאבגדשツシソヨ▓▒░█▚▞▌▐∴∵≋≈ᚠᚢᚦᚨᚱᚲᛉ¥§¶†‡ʬʭ";
  function jumble(len) {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += JUMBLE[Math.floor(Math.random() * JUMBLE.length)];
    }
    return s;
  }
  /** Flicker `el`'s text until it leaves the DOM or stop() is called. Works on
   *  anything with textContent -- a label, or an <option> in a <select>. */
  function glitchText(el, real, everyMs) {
    let timer = setInterval(() => {
      if (!el.isConnected) { stop(); return; }
      el.textContent = Math.random() < 0.4 ? real : jumble(3 + Math.floor(Math.random() * 4));
    }, everyMs || 70);
    function stop() {
      if (timer) { clearInterval(timer); timer = null; el.textContent = real; }
    }
    return stop;
  }

  /* ------------------------------------------------------------------------
   * Sizing: integer scale so the pet fills the stage without blurring.
   * ---------------------------------------------------------------------- */
  function fitInto(img, stage) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!w || !h || !sw || !sh) return;
    const s = Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(sw / w, sh / h))));
    img.style.width = w * s + "px";
    img.style.height = h * s + "px";
    img.dataset.scale = String(s);
  }

  /* ------------------------------------------------------------------------
   * Frame playback. Returns stop().
   * ---------------------------------------------------------------------- */
  function playOrdered(img, urls, fps) {
    if (urls.length < 2) return () => {};
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % urls.length;
      img.src = urls[i];
    }, 1000 / (fps || 8));
    return () => clearInterval(timer);
  }
  /** Random order, reshuffled every full pass (so every frame appears once per
   *  pass and the same frame never shows twice in a row), with jitter. */
  function playGlitch(img, urls, fps) {
    let order = [];
    let i = 0;
    let last = -1;
    const reshuffle = () => {
      order = urls.map((_, k) => k);
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
      if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
      i = 0;
    };
    reshuffle();
    const timer = setInterval(() => {
      if (i >= order.length) reshuffle();
      last = order[i++];
      img.src = urls[last];
      const jx = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const jy = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      img.style.setProperty("--cw-pet-jx", jx + "px");
      img.style.setProperty("--cw-pet-jy", jy + "px");
    }, 1000 / (fps || 11));
    return () => clearInterval(timer);
  }

  /* ------------------------------------------------------------------------
   * The feature-request form (Rishi's action). Loaded on first use only.
   * ---------------------------------------------------------------------- */
  let rishiModule = null;
  function openRishiRequest() {
    if (!rishiModule) {
      rishiModule = new Promise((resolve, reject) => {
        if (window.CthulhuRishiRequest) { resolve(window.CthulhuRishiRequest); return; }
        const s = document.createElement("script");
        s.src = ASSET_BASE + "rishi-request.js";
        s.onload = () => resolve(window.CthulhuRishiRequest);
        s.onerror = () => reject(new Error("could not load rishi-request.js"));
        document.head.appendChild(s);
      });
    }
    return rishiModule
      .then((m) => m.open())
      .catch((e) => {
        rishiModule = null; // let a later click retry the load
        console.error("[Cthulhu:pet] feature request:", e);
      });
  }

  /* ------------------------------------------------------------------------
   * Manifest (cached: several tiles can share it).
   * ---------------------------------------------------------------------- */
  let petsCache = null;
  function loadPets(ctx) {
    if (petsCache) return Promise.resolve(petsCache);
    return fetch(ctx.assetUrl("pets.json"))
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((list) => {
        const pets = (Array.isArray(list) ? list : [])
          .map((p) => (typeof p === "string" ? { id: p, name: p, frames: [p + ".png"] } : p))
          .filter((p) => p && p.id)
          .map((p) => ({ ...p, frames: (p.frames && p.frames.length) ? p.frames : [p.id + ".png"] }));
        petsCache = pets;
        return pets;
      });
  }
  function choose(pets, wanted) {
    if (wanted && wanted !== "random") {
      const found = pets.find((p) => p.id === wanted);
      if (found) return found;
      // Configured pet no longer in the manifest -- fall back to random rather
      // than rendering nothing.
    }
    return pets[Math.floor(Math.random() * pets.length)];
  }

  CthulhuWidgets.register({
    id: "pet",
    category: "aesthetic",
    name: "Pet",
    defaultSize: { w: 2, h: 2 },
    defaultConfig: { pet: "random", showName: true },
    css: `
      .cw-pet { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px; }
      .cw-pet-stage { display:flex; align-items:center; justify-content:center; min-height:0; flex:1; width:100%; }
      .cw-pet-img { image-rendering:pixelated; display:block; transform-origin:50% 100%; }
      .cw-pet-img.idle { animation: cw-pet-idle 2.4s ease-in-out infinite; }
      .cw-pet-img.glitch { transform: translate(var(--cw-pet-jx, 0px), var(--cw-pet-jy, 0px)); }
      @keyframes cw-pet-idle {
        0%, 100% { transform: translateY(0) scale(1, 1); }
        50%      { transform: translateY(-3px) scale(1.03, 0.97); }
      }
      /* An actionable pet is wrapped in a REAL button: GridStack does not
       * start a tile drag from a button (it is in the draggable cancel list),
       * so a plain click listener works -- unlike the rest of the tile, where
       * clicks have to be inferred from a drag that went nowhere. */
      .cw-pet-hit { background:none; border:none; padding:0; margin:0; cursor:pointer; display:block; border-radius:8px; }
      .cw-pet-hit:hover .cw-pet-img { filter: drop-shadow(0 0 6px var(--accent)); }
      .cw-pet-hit:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
      .cw-pet-name { color:var(--fg-muted); font-size:.85em; text-align:center; font-family:var(--font-pixel);
                     min-height:1.2em; font-variant-ligatures:none; }
      .cw-pet-empty { color:var(--fg-muted); font-size:.85em; text-align:center; padding:8px; }

      /* Picker in the gear panel. A LIST OF BUTTONS, not a <select>.
       *
       * A native <select> puts its menu in a chrome-level popup that this page
       * only reaches through the ContentSelectDropdown actor pair. That round
       * trip is what stopped a pick from ever landing -- the popup opened, the
       * chosen value never came back as a change event, so the pet stayed on
       * Random. Plain buttons are a plain DOM click, and they let KIY's name
       * flicker where you can actually see it: in the list itself, rather than
       * only inside a popup that has to be held open. */
      .cw-pet-list { display:flex; flex-direction:column; gap:4px; }
      .cw-pet-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:5px 6px;
        border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg);
        font-family:var(--font-pixel); font-size:.85em; cursor:pointer; }
      .cw-pet-row:hover { border-color:var(--accent); }
      .cw-pet-row.on { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, var(--surface)); }
      .cw-pet-row img { flex:none; width:22px; height:22px; object-fit:contain; image-rendering:pixelated; }
      .cw-pet-row .dot { flex:none; width:22px; height:22px; border-radius:5px; background:var(--bg-elevated);
        border:1px solid var(--border); }
      .cw-pet-rowname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-variant-ligatures:none; }
      .cw-pet-note { color:var(--fg-muted); font-size:.78em; }
    `,

    render(el, ctx) {
      el.innerHTML =
        '<div class="cw-pet">' +
          '<div class="cw-pet-stage"></div>' +
          '<div class="cw-pet-name"></div>' +
        "</div>";
      const stage = el.querySelector(".cw-pet-stage");
      const nameEl = el.querySelector(".cw-pet-name");

      // The manifest fetch and the image load are async, so this render can be
      // torn down (widget removed, or re-rendered by a config change) while
      // they're in flight. Track that and bail rather than animating a
      // detached element or leaking a running timer past cleanup.
      let disposed = false;
      const stops = [];
      ctx.onCleanup(() => {
        disposed = true;
        for (const s of stops) { try { s(); } catch (e) {} }
      });

      (async () => {
        let pets;
        try {
          pets = await loadPets(ctx);
        } catch (e) {
          console.warn("[Cthulhu:pet] pets.json:", e.message);
          pets = [];
        }
        if (disposed) return;
        if (!pets.length) {
          el.querySelector(".cw-pet").innerHTML =
            '<div class="cw-pet-empty">No pets found in assets/pets.json</div>';
          return;
        }

        const pet = choose(pets, ctx.config && ctx.config.pet);
        const name = pet.name || pet.id;
        const glitch = pet.mode === "glitch";
        const urls = pet.frames.map((f) => ctx.assetUrl(f));

        // Label. A glitch pet's name never sits still.
        if (ctx.config && ctx.config.showName === false) {
          nameEl.textContent = "";
        } else if (glitch) {
          nameEl.textContent = name;
          stops.push(glitchText(nameEl, name));
        } else {
          nameEl.textContent = name;
        }

        // Sprite.
        const img = document.createElement("img");
        img.className = "cw-pet-img " + (glitch ? "glitch" : "idle");
        img.alt = name;
        img.draggable = false;
        img.dataset.pet = pet.id;
        img.decoding = "async";

        let host = img;
        if (pet.action === "feature-request") {
          const hit = document.createElement("button");
          hit.type = "button";
          hit.className = "cw-pet-hit";
          hit.title = pet.hint || "Send a feature request";
          hit.setAttribute("aria-label", hit.title);
          hit.appendChild(img);
          // Don't let the press bubble to GridStack as the start of a tile drag.
          hit.addEventListener("pointerdown", (e) => e.stopPropagation());
          hit.addEventListener("click", (e) => { e.stopPropagation(); openRishiRequest(); });
          host = hit;
        }

        img.addEventListener("load", () => { if (!disposed) fitInto(img, stage); }, { once: true });
        img.src = urls[0];
        stage.appendChild(host);

        // Re-fit when the tile is resized. All frames of one pet share a size,
        // so fitting once per resize (not per frame) is enough.
        if (typeof ResizeObserver === "function") {
          const ro = new ResizeObserver(() => { if (!disposed) fitInto(img, stage); });
          ro.observe(stage);
          stops.push(() => ro.disconnect());
        }

        if (urls.length > 1) {
          // Decode every frame up front so the swap never flashes a blank.
          for (const u of urls) { const pre = new Image(); pre.src = u; }
          stops.push(glitch ? playGlitch(img, urls, pet.fps) : playOrdered(img, urls, pet.fps));
        }
      })();
    },

    /* Clicking the tile re-rolls, but only in Random mode -- if you deliberately
     * picked a pet, a stray click shouldn't silently swap it out. (Whole-tile
     * clicks arrive here rather than via a click listener; see widgets/README.md
     * -- GridStack swallows the native click on a grabbable tile. Rishi's own
     * button is exempt: it is a real button and handles its own click.) */
    onClick(ctx) {
      if (!ctx.config || ctx.config.pet === "random") ctx.refresh();
    },

    configUI(panel, ctx) {
      const cfg = ctx.config || {};

      const list = document.createElement("div");
      list.className = "cw-pet-list";
      panel.appendChild(list);

      const hint = document.createElement("div");
      hint.className = "cw-pet-note";
      panel.appendChild(hint);

      const nameRow = document.createElement("label");
      const nameBox = document.createElement("input");
      nameBox.type = "checkbox";
      nameBox.checked = cfg.showName !== false;
      nameRow.appendChild(nameBox);
      nameRow.appendChild(document.createTextNode(" Show pet name"));
      panel.appendChild(nameRow);
      nameBox.addEventListener("change", () => {
        ctx.saveConfig({ ...ctx.config, showName: nameBox.checked }, { refresh: true });
      });

      loadPets(ctx).then((pets) => {
        const opts = [{ id: "random", name: "Random (new pet each tab)" }, ...pets];
        const rows = [];
        const paint = () => {
          const cur = (ctx.config && ctx.config.pet) || "random";
          for (const r of rows) r.el.classList.toggle("on", r.id === cur);
          const p = pets.find((x) => x.id === cur);
          hint.textContent = p && p.hint ? p.hint : "";
        };
        for (const o of opts) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "cw-pet-row";
          row.setAttribute("data-pet", o.id);

          if (o.frames && o.frames.length) {
            const img = document.createElement("img");
            img.alt = "";
            img.draggable = false;
            img.src = ctx.assetUrl(o.frames[0]);
            row.appendChild(img);
          } else {
            const dot = document.createElement("span");
            dot.className = "dot";
            row.appendChild(dot);
          }

          const label = document.createElement("span");
          label.className = "cw-pet-rowname";
          label.textContent = o.name || o.id;
          row.appendChild(label);
          // KIY's name is restless wherever it appears -- and here it is on
          // screen the whole time the panel is open. The timer stops itself
          // when the panel closes and the node leaves the document.
          if (o.mode === "glitch") glitchText(label, o.name || o.id, 80);

          row.addEventListener("click", (e) => {
            e.stopPropagation();
            ctx.saveConfig({ ...ctx.config, pet: o.id }, { refresh: true });
            paint();
          });
          rows.push({ id: o.id, el: row });
          list.appendChild(row);
        }
        paint();
      }).catch((e) => {
        const err = document.createElement("div");
        err.className = "cw-pet-empty";
        err.textContent = "Could not load pets.json: " + e.message;
        panel.appendChild(err);
      });
    },
  });
})();
