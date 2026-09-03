/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Reference board widget (utility, for drawing from reference). Pin pictures to
 * a tile: paste from the clipboard, pick a recent file, or browse. Click one
 * to see it big; hover for remove. Pictures are stored inline (data URLs) in
 * this tile's config, so a board survives restarts and syncs with the layout;
 * a dozen phone-sized photos is fine, a hundred is not -- there is a cap. */
CthulhuWidgets.register({
  id: "refboard",
  category: "utility",
  name: "Reference Board",
  defaultSize: { w: 3, h: 3 },
  defaultConfig: { images: [], cols: 3 },
  css: `
    .cw-ref { display:flex; flex-direction:column; height:100%; gap:6px; }
    .cw-ref-bar { display:flex; align-items:center; gap:6px; flex:none; font-size:.78em; color:var(--fg-muted); }
    .cw-ref-btn { margin-inline-start:auto; flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg);
      border-radius:5px; cursor:pointer; font-family:var(--font-pixel); font-size:11px; padding:3px 7px; line-height:1; }
    .cw-ref-btn:hover { border-color:var(--accent); }
    .cw-ref-grid { flex:1; min-height:0; overflow-y:auto; column-gap:6px; }
    .cw-ref-item { position:relative; break-inside:avoid; margin-bottom:6px; border-radius:6px; overflow:hidden;
      border:1px solid var(--border); cursor:zoom-in; }
    .cw-ref-item:hover { border-color:var(--accent); }
    .cw-ref-item img { display:block; width:100%; height:auto; }
    .cw-ref-x { position:absolute; top:3px; right:3px; width:16px; height:16px; border:none; border-radius:3px;
      background:rgba(0,0,0,.6); color:#fff; font-size:11px; line-height:1; cursor:pointer; opacity:0; padding:0; }
    .cw-ref-item:hover .cw-ref-x { opacity:1; }
    .cw-ref-empty { color:var(--fg-muted); font-size:.85em; display:grid; place-items:center; height:100%; text-align:center; padding:10px; }
    .cw-ref-light { position:fixed; inset:0; z-index:420; background:rgba(0,0,0,.82); display:grid; place-items:center; cursor:zoom-out; }
    .cw-ref-light img { max-width:92vw; max-height:92vh; border-radius:6px; box-shadow:0 10px 40px rgba(0,0,0,.6); }
  `,
  render(el, ctx) {
    const MAX = 24;
    const root = document.createElement("div"); root.className = "cw-ref";
    const bar = document.createElement("div"); bar.className = "cw-ref-bar";
    const count = document.createElement("span"); count.textContent = (ctx.config.images.length) + " / " + MAX;
    const add = document.createElement("button"); add.type = "button"; add.className = "cw-ref-btn"; add.textContent = "+ Add";
    add.addEventListener("click", async () => {
      if (ctx.config.images.length >= MAX) return ctx.ui.toast("Board is full (" + MAX + ")");
      const url = await ctx.pickImage(); if (!url) return;
      ctx.saveConfig({ ...ctx.config, images: [...ctx.config.images, url] }, { refresh: true });
    });
    bar.appendChild(count); bar.appendChild(add); root.appendChild(bar);

    const grid = document.createElement("div"); grid.className = "cw-ref-grid";
    grid.style.columnCount = String(Math.max(1, +ctx.config.cols || 3));
    if (!ctx.config.images.length) { const e = document.createElement("div"); e.className = "cw-ref-empty"; e.textContent = "Pin references here — paste, pick a recent file, or browse."; grid.appendChild(e); }
    ctx.config.images.forEach((src, i) => {
      const it = document.createElement("div"); it.className = "cw-ref-item";
      const img = document.createElement("img"); img.src = src; img.alt = ""; it.appendChild(img);
      const x = document.createElement("button"); x.type = "button"; x.className = "cw-ref-x"; x.textContent = "×"; x.title = "Remove";
      x.addEventListener("click", (e) => { e.stopPropagation(); ctx.saveConfig({ ...ctx.config, images: ctx.config.images.filter((_, j) => j !== i) }, { refresh: true }); });
      it.appendChild(x);
      it.addEventListener("click", () => {
        const light = document.createElement("div"); light.className = "cw-ref-light";
        const big = document.createElement("img"); big.src = src; light.appendChild(big);
        light.addEventListener("click", () => light.remove());
        document.body.appendChild(light);
      });
      grid.appendChild(it);
    });
    root.appendChild(grid); el.appendChild(root);
  },
  configUI(panel, ctx) {
    panel.appendChild(ctx.ui.selectRow("Columns", [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })), ctx.config.cols || 3,
      (v) => ctx.saveConfig({ ...ctx.config, cols: +v }, { refresh: true })));
    panel.appendChild(ctx.ui.button("Clear the board", () => { ctx.saveConfig({ ...ctx.config, images: [] }, { refresh: true }); ctx.closeConfig(); }));
  },
});
