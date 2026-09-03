/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Palette widget (utility, for painting). Keeps colour palettes you can reach
 * for while drawing:
 *
 *   click a swatch         copy its hex to the clipboard
 *   hover a swatch, x      remove it
 *   +                      add a colour (picker + hex)
 *   dice                   a fresh harmonious palette (random scheme)
 *   image                  pull the 5 dominant colours out of any picture
 *                          (recent files / clipboard / browse) -- k-means on a
 *                          downscaled copy, so it is instant
 *   the name at the top    switch between saved palettes; rename / delete in ⚙
 *
 * Palettes are this tile's config, so several tiles can hold different sets. */
(function () {
  "use strict";
  const C = () => CthulhuThemes.color;

  function harmony() {
    const h = Math.random() * 360;
    const schemes = [[0, 30, 60, 180, 210], [0, 120, 240, 60, 300], [0, 150, 210, 30, 330], [0, 15, 30, 45, 60], [0, 180, 90, 270, 45]];
    const s = schemes[Math.floor(Math.random() * schemes.length)];
    return s.map((d, i) => C().hslToHex(h + d, 0.45 + Math.random() * 0.4, 0.35 + (i / s.length) * 0.4));
  }
  /** 5 dominant colours from a data URL (k-means on a 48px thumbnail). */
  function dominant(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas"); const N = 48;
        cv.width = N; cv.height = Math.max(1, Math.round(N * img.height / img.width));
        const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, cv.width, cv.height);
        const d = g.getImageData(0, 0, cv.width, cv.height).data, px = [];
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
        if (!px.length) return resolve([]);
        let cents = [0, 1, 2, 3, 4].map((k) => px[Math.floor((k + 0.5) * px.length / 5)]);
        for (let it = 0; it < 10; it++) {
          const sums = cents.map(() => [0, 0, 0, 0]);
          for (const p of px) {
            let best = 0, bd = Infinity;
            cents.forEach((c, k) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = k; } });
            const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
          }
          cents = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[k]));
        }
        resolve(cents.map((c) => C().rgbToHex(c[0], c[1], c[2])));
      };
      img.onerror = () => resolve([]);
      img.src = dataUrl;
    });
  }

  CthulhuWidgets.register({
    id: "palette",
    category: "utility",
    name: "Palette",
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { palettes: [{ name: "Studio", colors: ["#1a1a1a", "#5ad1b0", "#e8e8e8", "#6c8cff", "#ff7aa2"] }], current: 0 },
    css: `
      .cw-pal { display:flex; flex-direction:column; height:100%; gap:6px; }
      .cw-pal-bar { display:flex; align-items:center; gap:6px; flex:none; }
      .cw-pal-bar select { flex:1; min-width:0; background:var(--bg); color:var(--fg); border:1px solid var(--border);
        border-radius:5px; font-family:var(--font-pixel); font-size:.8em; padding:2px 4px; }
      .cw-pal-btn { flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg);
        border-radius:5px; cursor:pointer; font-family:var(--font-pixel); font-size:11px; padding:3px 6px; line-height:1; }
      .cw-pal-btn:hover { border-color:var(--accent); }
      .cw-pal-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(44px, 1fr)); gap:6px;
        align-content:start; overflow-y:auto; }
      .cw-pal-sw { position:relative; aspect-ratio:1; border-radius:6px; border:1px solid var(--border); cursor:pointer;
        display:flex; align-items:flex-end; justify-content:center; padding:0; overflow:hidden; }
      .cw-pal-sw:hover { border-color:var(--accent); }
      .cw-pal-sw span { font-size:9px; font-family:var(--font-pixel); padding:1px 3px; border-radius:3px 3px 0 0;
        background:rgba(0,0,0,.55); color:#fff; opacity:0; }
      .cw-pal-sw:hover span { opacity:1; }
      .cw-pal-x { position:absolute; top:1px; right:1px; width:14px; height:14px; border:none; border-radius:3px;
        background:rgba(0,0,0,.55); color:#fff; font-size:10px; line-height:1; cursor:pointer; opacity:0; padding:0; }
      .cw-pal-sw:hover .cw-pal-x { opacity:1; }
      .cw-pal-empty { color:var(--fg-muted); font-size:.82em; }
    `,
    render(el, ctx) {
      const cfg = () => ctx.config;
      const cur = () => cfg().palettes[Math.min(cfg().current || 0, cfg().palettes.length - 1)] || null;
      const save = (patch, refresh) => ctx.saveConfig({ ...cfg(), ...patch }, { refresh: refresh !== false });

      const root = document.createElement("div"); root.className = "cw-pal";
      const bar = document.createElement("div"); bar.className = "cw-pal-bar";
      const sel = document.createElement("select");
      cfg().palettes.forEach((p, i) => { const o = document.createElement("option"); o.value = i; o.textContent = p.name || ("Palette " + (i + 1)); if (i === (cfg().current || 0)) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => save({ current: +sel.value }));
      bar.appendChild(sel);
      const btn = (txt, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "cw-pal-btn"; b.textContent = txt; b.title = title; b.addEventListener("click", fn); bar.appendChild(b); return b; };
      btn("+", "Add a colour", () => ctx.openConfig());
      btn("🎲", "Random harmonious palette", () => {
        const palettes = cfg().palettes.slice(); palettes.push({ name: "Random " + (palettes.length + 1), colors: harmony() });
        save({ palettes, current: palettes.length - 1 });
      });
      btn("🖼", "Colours from an image", async () => {
        const url = await ctx.pickImage(); if (!url) return;
        const colors = await dominant(url); if (!colors.length) return ctx.ui.toast("No colours found");
        const palettes = cfg().palettes.slice(); palettes.push({ name: "From image " + (palettes.length + 1), colors });
        save({ palettes, current: palettes.length - 1 });
      });
      root.appendChild(bar);

      const grid = document.createElement("div"); grid.className = "cw-pal-grid";
      const p = cur();
      if (!p || !p.colors.length) { const e = document.createElement("div"); e.className = "cw-pal-empty"; e.textContent = "No colours yet — press + or 🎲."; grid.appendChild(e); }
      else p.colors.forEach((hex, i) => {
        const sw = document.createElement("button"); sw.type = "button"; sw.className = "cw-pal-sw"; sw.style.background = hex; sw.title = hex + " — click to copy";
        const lab = document.createElement("span"); lab.textContent = hex; sw.appendChild(lab);
        const x = document.createElement("button"); x.type = "button"; x.className = "cw-pal-x"; x.textContent = "×"; x.title = "Remove";
        x.addEventListener("click", (e) => { e.stopPropagation(); const palettes = cfg().palettes.map((q, k) => (k === (cfg().current || 0) ? { ...q, colors: q.colors.filter((_, j) => j !== i) } : q)); save({ palettes }); });
        sw.appendChild(x);
        sw.addEventListener("click", async () => { try { await navigator.clipboard.writeText(hex); ctx.ui.toast("Copied " + hex); } catch (e) { ctx.ui.toast(hex); } });
        grid.appendChild(sw);
      });
      root.appendChild(grid); el.appendChild(root);
    },
    configUI(panel, ctx) {
      const cfg = () => ctx.config;
      const idx = () => Math.min(cfg().current || 0, cfg().palettes.length - 1);
      const save = (patch) => ctx.saveConfig({ ...cfg(), ...patch }, { refresh: true });
      const p = cfg().palettes[idx()];
      if (p) {
        const f = ctx.ui.field("Add to “" + (p.name || "palette") + "”");
        let pending = "#5ad1b0";
        f.appendChild(ctx.ui.colorRow("Colour", pending, (hex) => { pending = hex; }));
        f.appendChild(ctx.ui.button("Add colour", () => {
          const palettes = cfg().palettes.map((q, k) => (k === idx() ? { ...q, colors: [...q.colors, pending] } : q)); save({ palettes });
        }, { primary: true }));
        panel.appendChild(f);
        panel.appendChild(ctx.ui.textRow("Rename", p.name || "", (v) => { const palettes = cfg().palettes.map((q, k) => (k === idx() ? { ...q, name: v } : q)); save({ palettes }); }));
        panel.appendChild(ctx.ui.button("Delete this palette", () => {
          const palettes = cfg().palettes.filter((_, k) => k !== idx()); save({ palettes: palettes.length ? palettes : [{ name: "Studio", colors: [] }], current: 0 });
        }));
      }
      panel.appendChild(ctx.ui.button("New empty palette", () => { const palettes = [...cfg().palettes, { name: "Palette " + (cfg().palettes.length + 1), colors: [] }]; save({ palettes, current: palettes.length - 1 }); }));
    },
  });
})();
