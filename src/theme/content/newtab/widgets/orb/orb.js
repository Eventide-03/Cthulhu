/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Orb widget (aesthetic, animated). Plays the spritesheet at assets/orb.png +
 * orb.json through the sprite helper, and lets you COLOUR it.
 *
 * Colouring is a CSS filter, not a repaint, so it works on whatever art is in
 * the slot: the sheet's dominant hue/saturation/lightness are measured once
 * (canvas, opaque pixels only) and the filter is the delta from that to the
 * colour you picked -- hue-rotate for the hue, saturate/brightness for the
 * rest. Shading inside the art is preserved; a flat recolour would lose it.
 *
 *   colour ""  -> follow the theme accent (live; re-measured on theme change)
 *   colour hex -> that colour
 *   glow       -> a soft drop-shadow in the same colour
 *
 * Drop your own art at assets/orb.png + orb.json (Aseprite horizontal strip;
 * frame size/count come from the JSON). */
const _cthOrbStats = Object.create(null); // sheet url -> {h,s,l}
function _cthOrbMeasure(url) {
  if (_cthOrbStats[url]) return Promise.resolve(_cthOrbStats[url]);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
        const c2 = cv.getContext("2d", { willReadFrequently: true }); c2.drawImage(img, 0, 0);
        const d = c2.getImageData(0, 0, cv.width, cv.height).data;
        let sx = 0, sy = 0, ss = 0, sl = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const hsl = CthulhuThemes.color.hexToHsl(CthulhuThemes.color.rgbToHex(d[i], d[i + 1], d[i + 2]));
          if (!hsl || hsl[1] < 0.08) { sl += hsl ? hsl[2] : 0; n++; continue; } // greys: no hue vote
          const a = hsl[0] * Math.PI / 180;
          sx += Math.cos(a) * hsl[1]; sy += Math.sin(a) * hsl[1]; ss += hsl[1]; sl += hsl[2]; n++;
        }
        const h = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
        _cthOrbStats[url] = n ? { h, s: ss / n, l: sl / n } : { h: 0, s: 0.5, l: 0.5 };
      } catch (e) { _cthOrbStats[url] = { h: 0, s: 0.5, l: 0.5 }; }
      resolve(_cthOrbStats[url]);
    };
    img.onerror = () => resolve({ h: 0, s: 0.5, l: 0.5 });
    img.src = url;
  });
}
function _cthOrbFilter(base, hex, glow) {
  const t = CthulhuThemes.color.hexToHsl(hex);
  if (!t) return "";
  const dh = Math.round(t[0] - base.h);
  const sat = Math.max(0.2, Math.min(3, base.s > 0.02 ? t[1] / base.s : 1));
  const bri = Math.max(0.5, Math.min(1.8, base.l > 0.02 ? t[2] / base.l : 1));
  let f = "hue-rotate(" + dh + "deg) saturate(" + sat.toFixed(2) + ") brightness(" + bri.toFixed(2) + ")";
  if (glow) f += " drop-shadow(0 0 7px " + hex + ")";
  return f;
}
const _cthOrbPresets = [
  { id: "teal", name: "Teal", colors: ["#5ad1b0"] }, { id: "blue", name: "Blue", colors: ["#6c8cff"] },
  { id: "violet", name: "Violet", colors: ["#b48cff"] }, { id: "rose", name: "Rose", colors: ["#ff7aa2"] },
  { id: "ember", name: "Ember", colors: ["#ff8a3d"] }, { id: "gold", name: "Gold", colors: ["#f5c542"] },
  { id: "lime", name: "Lime", colors: ["#8bd17c"] }, { id: "white", name: "White", colors: ["#f0f0f0"] },
];
CthulhuWidgets.register({
  id: "orb",
  category: "aesthetic",
  name: "Orb",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: { color: "", glow: true, scale: 3 },
  css: `
    .cw-orb { display:flex; align-items:center; justify-content:center; height:100%; }
    .cw-orb .cthulhu-sprite { image-rendering:pixelated; }
  `,
  render(el, ctx) {
    const wrap = document.createElement("div"); wrap.className = "cw-orb";
    const sprite = document.createElement("div"); sprite.className = "cw-orb-sprite";
    sprite.style.transform = "scale(" + (Math.max(1, +ctx.config.scale || 3)) + ")";
    wrap.appendChild(sprite); el.appendChild(wrap);
  },
  animate(el, ctx) {
    const sprite = el.querySelector(".cw-orb-sprite");
    if (!ctx.sprite || !sprite) return;
    let disposed = false;
    ctx.onCleanup(() => { disposed = true; });
    const jsonUrl = ctx.assetUrl("orb.json");
    ctx.sprite.fromAseprite(sprite, jsonUrl, { mode: "css" })
      .then((ctrl) => ctx.onCleanup(() => ctrl && ctrl.stop && ctrl.stop()))
      .catch((e) => console.warn("[Cthulhu:orb] sprite:", e.message));

    // Colour: measure the sheet the JSON names, then apply / re-apply on theme change.
    const applyColor = async () => {
      let sheet = ctx.assetUrl("orb.png");
      try { const j = await (await fetch(jsonUrl)).json(); if (j.meta && j.meta.image) sheet = jsonUrl.slice(0, jsonUrl.lastIndexOf("/") + 1) + j.meta.image; } catch (e) {}
      const base = await _cthOrbMeasure(sheet);
      if (disposed) return;
      const hex = (ctx.config.color && ctx.theme.color.isHex(ctx.config.color)) ? ctx.config.color : ctx.theme.tokens().accent;
      sprite.style.filter = _cthOrbFilter(base, hex, ctx.config.glow !== false);
    };
    applyColor();
    const onTheme = () => { if (!ctx.config.color) applyColor(); };
    document.addEventListener("cthulhu-theme-change", onTheme);
    ctx.onCleanup(() => document.removeEventListener("cthulhu-theme-change", onTheme));
  },
  configUI(panel, ctx) {
    const save = (patch) => ctx.saveConfig({ ...ctx.config, ...patch }, { refresh: true });
    panel.appendChild(ctx.ui.checkRow("Follow the theme accent", !ctx.config.color, (v) => save({ color: v ? "" : ctx.theme.tokens().accent })));
    const f = ctx.ui.field("Colour");
    f.appendChild(ctx.ui.swatches(_cthOrbPresets, null, (p) => save({ color: p.colors[0] })));
    f.appendChild(ctx.ui.colorRow("Custom", ctx.config.color || ctx.theme.tokens().accent, (hex) => save({ color: hex })));
    panel.appendChild(f);
    panel.appendChild(ctx.ui.checkRow("Glow", ctx.config.glow !== false, (v) => save({ glow: v })));
    panel.appendChild(ctx.ui.rangeRow("Size", { min: 1, max: 6, step: 1, value: ctx.config.scale || 3, unit: "×" }, (v) => save({ scale: v })));
  },
});
