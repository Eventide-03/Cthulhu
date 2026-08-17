/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Pet widget (aesthetic, animated). Shows an idle-looping pixel pet -- either a
 * specific one you pick, or "Random", which re-rolls on every render: a new tab,
 * a home-page refresh, or a click on the tile.
 *
 * ART SLOTS: every pet is just a pair of files in assets/ plus one line in
 * assets/pets.json -- the same drop-in convention the widget registry itself
 * uses (widgets/index.json), so adding a pet never means editing this file:
 *
 *   assets/<id>.png    horizontal strip, N frames of equal size (32x32 here)
 *   assets/<id>.json   Aseprite-format sheet JSON (frame rects + durations;
 *                      `meta.image` names the PNG, resolved next to the JSON)
 *   assets/pets.json   [{ "id": "<id>", "name": "<Display Name>" }, ...]
 *
 * The bundled cat/dog/frog/ghost are crude placeholders -- flat shapes meant to
 * be replaced. Frame size and count are read from each pet's own JSON, so real
 * art is free to use a different size or a longer animation without touching
 * any code here. */
CthulhuWidgets.register({
  id: "pet",
  category: "aesthetic",
  name: "Pet",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: { pet: "random", showName: true },
  css: `
    .cw-pet { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:8px; }
    .cw-pet-stage { display:flex; align-items:center; justify-content:center; min-height:0; flex:1; width:100%; }
    /* The sprite element is sized to ONE frame by the sprite helper; scaling it
     * up here (rather than baking a bigger sheet) keeps the art crisp and lets
     * any frame size work. transform doesn't affect layout, so center it via
     * the flex stage above. */
    .cw-pet .cthulhu-sprite { transform:scale(3); image-rendering:pixelated; }
    .cw-pet-name { color:var(--fg-muted); font-size:.85em; text-align:center; font-family:var(--font-pixel); }
    .cw-pet-empty { color:var(--fg-muted); font-size:.85em; text-align:center; padding:8px; }
  `,

  render(el, ctx) {
    el.innerHTML =
      '<div class="cw-pet">' +
        '<div class="cw-pet-stage"><div class="cw-pet-sprite"></div></div>' +
        '<div class="cw-pet-name"></div>' +
      "</div>";
    const spriteEl = el.querySelector(".cw-pet-sprite");
    const nameEl = el.querySelector(".cw-pet-name");

    // The manifest fetch and the sprite load are both async, so this render can
    // be torn down (widget removed, or re-rendered by a config change) while
    // they're still in flight. Track that and bail rather than animating a
    // detached element or leaking a running sprite past cleanup.
    let disposed = false;
    let ctrl = null;
    ctx.onCleanup(() => {
      disposed = true;
      if (ctrl && ctrl.stop) ctrl.stop();
    });

    (async () => {
      let pets;
      try {
        pets = await _cthPetLoad(ctx);
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

      const pet = _cthPetChoose(pets, ctx.config && ctx.config.pet);
      nameEl.textContent = ctx.config && ctx.config.showName === false ? "" : pet.name || pet.id;

      try {
        const c = await ctx.sprite.fromAseprite(spriteEl, ctx.assetUrl(pet.id + ".json"), { mode: "css" });
        // cleanup may have run while the sheet was loading -- honour it.
        if (disposed) { if (c && c.stop) c.stop(); return; }
        ctrl = c;
      } catch (e) {
        console.warn("[Cthulhu:pet] sprite " + pet.id + ":", e.message);
        if (!disposed) nameEl.textContent = (pet.name || pet.id) + " (art missing)";
      }
    })();
  },

  /* Clicking the tile re-rolls, but only in Random mode -- if you deliberately
   * picked a pet, a stray click shouldn't silently swap it out. (Whole-tile
   * clicks arrive here rather than via a click listener; see widgets/README.md
   * -- GridStack swallows the native click on a grabbable tile.) */
  onClick(ctx) {
    if (!ctx.config || ctx.config.pet === "random") ctx.refresh();
  },

  configUI(panel, ctx) {
    const cfg = ctx.config || {};

    const petRow = document.createElement("label");
    petRow.textContent = "Pet";
    const select = document.createElement("select");
    petRow.appendChild(select);
    panel.appendChild(petRow);

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

    // Populate from the manifest so a newly-dropped-in pet shows up here with
    // no code change.
    _cthPetLoad(ctx).then((pets) => {
      const opts = [{ id: "random", name: "Random (new pet each tab)" }, ...pets];
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = o.name || o.id;
        if ((cfg.pet || "random") === o.id) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        ctx.saveConfig({ ...ctx.config, pet: select.value }, { refresh: true });
      });
    }).catch((e) => {
      const err = document.createElement("div");
      err.className = "cw-pet-empty";
      err.textContent = "Could not load pets.json: " + e.message;
      panel.appendChild(err);
    });
  },
});

/* --- manifest loading (module-scope, shared by every instance) --------------
 * Cached after the first successful load: the palette can hold several pet
 * tiles and each re-renders on every page load, and they'd otherwise each
 * refetch the same tiny file. */
let _cthPetsCache = null;
function _cthPetLoad(ctx) {
  if (_cthPetsCache) return Promise.resolve(_cthPetsCache);
  return fetch(ctx.assetUrl("pets.json"))
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((list) => {
      // Tolerate either ["cat", ...] or [{id,name}, ...] so a hand-edited
      // manifest in the simpler shape still works.
      const pets = (Array.isArray(list) ? list : [])
        .map((p) => (typeof p === "string" ? { id: p, name: p } : p))
        .filter((p) => p && p.id);
      _cthPetsCache = pets;
      return pets;
    });
}

function _cthPetChoose(pets, wanted) {
  if (wanted && wanted !== "random") {
    const found = pets.find((p) => p.id === wanted);
    if (found) return found;
    // Configured pet was removed from assets/ -- fall back to random rather
    // than rendering nothing.
  }
  return pets[Math.floor(Math.random() * pets.length)];
}
