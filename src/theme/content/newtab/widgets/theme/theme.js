/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Theme widget (utility). Changes the theme of the WHOLE BROWSER -- chrome and
 * every about:cthulhu page -- by writing the `cthulhu.theme` pref; the theme
 * engine (content/themes.js) applies it everywhere and this tile just reflects
 * it. Nothing here is per-widget state, which is why there is no configUI:
 * two Theme tiles always agree.
 *
 *   - click a theme      -> apply it
 *   - star a theme       -> pin it into the Favourites section at the top
 *   - "Ambient"          -> follow the time of day (dawn / day / dusk / night)
 *
 * Presets come from CthulhuThemes.presets(); add one there and it appears here.
 * Controls are built with createElement (innerHTML drops <button> on this
 * privileged page -- see widgets/README.md). */
CthulhuWidgets.register({
  id: "theme",
  category: "utility",
  name: "Theme",
  defaultSize: { w: 3, h: 3 },
  defaultConfig: { showMood: true },
  css: `
    .cw-theme { display:flex; flex-direction:column; height:100%; gap:6px; }
    .cw-theme-now { font-size:.78em; color:var(--fg-muted); flex:none; }
    .cw-theme-now b { color:var(--fg); font-weight:normal; }
    .cw-theme-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
    .cw-theme-sec { font-size:.68em; color:var(--fg-muted); text-transform:uppercase; letter-spacing:.08em; margin:4px 0 0; }
    .cw-theme-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:5px 6px;
      border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg);
      font-family:var(--font-pixel); font-size:.85em; cursor:pointer; }
    .cw-theme-row:hover { border-color:var(--accent); }
    .cw-theme-row.on { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, var(--surface)); }
    /* swatch: the palette's own bg square with its accent dot -- real colours,
       not var(), because it must show the theme you WOULD get, not the current one */
    .cw-theme-sw { flex:none; width:22px; height:22px; border-radius:5px; border:1px solid rgba(128,128,128,.35);
      display:grid; place-items:center; image-rendering:pixelated; }
    .cw-theme-sw i { width:9px; height:9px; border-radius:50%; display:block; }
    .cw-theme-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cw-theme-mood { color:var(--fg-muted); font-size:.82em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:45%; }
    .cw-theme-star { flex:none; border:none; background:transparent; color:var(--fg-muted); cursor:pointer;
      font-size:1.05em; line-height:1; padding:0 2px; }
    .cw-theme-star.on, .cw-theme-star:hover { color:var(--accent); }
    .cw-theme-band { flex:none; font-size:.72em; color:var(--fg-muted); }
  `,
  render(el, ctx) {
    const T = ctx.theme;
    if (!T) { el.textContent = "Theme engine not loaded."; return; }
    const wrap = document.createElement("div"); wrap.className = "cw-theme";
    const now = document.createElement("div"); now.className = "cw-theme-now";
    const list = document.createElement("div"); list.className = "cw-theme-list";
    wrap.appendChild(now); wrap.appendChild(list); el.appendChild(wrap);

    const row = (preset, opts) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "cw-theme-row";
      b.dataset.id = preset.id;
      const sw = document.createElement("span"); sw.className = "cw-theme-sw";
      sw.style.background = preset.tokens.bg;
      const dot = document.createElement("i"); dot.style.background = preset.tokens.accent; sw.appendChild(dot);
      const name = document.createElement("span"); name.className = "cw-theme-name"; name.textContent = preset.name;
      b.appendChild(sw); b.appendChild(name);
      if (opts && opts.band) { const bd = document.createElement("span"); bd.className = "cw-theme-band"; bd.textContent = opts.band; b.appendChild(bd); }
      else if (ctx.config.showMood !== false && preset.mood) { const m = document.createElement("span"); m.className = "cw-theme-mood"; m.textContent = preset.mood; b.appendChild(m); }
      if (!opts || !opts.noStar) {
        const star = document.createElement("button"); star.type = "button"; star.className = "cw-theme-star";
        star.title = "Favourite"; star.textContent = "★";
        star.addEventListener("click", (e) => { e.stopPropagation(); T.toggleFavorite(preset.id); build(); });
        b.appendChild(star);
      }
      b.addEventListener("click", () => T.setTheme(preset.id));
      return b;
    };
    const section = (text) => { const h = document.createElement("div"); h.className = "cw-theme-sec"; h.textContent = text; return h; };

    function build() {
      list.innerHTML = "";
      const r = T.resolve();
      now.innerHTML = "";
      now.appendChild(document.createTextNode("Now: "));
      const b = document.createElement("b");
      b.textContent = r.id === T.AMBIENT ? "Ambient (" + r.preset.name + ")" : r.preset.name;
      now.appendChild(b);

      // Ambient is a virtual entry: its swatch shows the band it currently resolves to.
      const amb = row({ id: T.AMBIENT, name: "Ambient", tokens: r.id === T.AMBIENT ? r.preset.tokens : T.get(T.band()).tokens },
                      { band: "follows time of day", noStar: true });
      list.appendChild(amb);

      const favs = T.favorites();
      const presets = T.presets();
      if (favs.length) {
        list.appendChild(section("Favourites"));
        for (const id of favs) { const p = T.get(id); if (p) list.appendChild(row(p)); }
      }
      list.appendChild(section(favs.length ? "All themes" : "Themes"));
      for (const p of presets) if (!favs.includes(p.id)) list.appendChild(row(p));
      // highlight
      for (const btn of list.querySelectorAll(".cw-theme-row")) btn.classList.toggle("on", btn.dataset.id === r.id);
      for (const btn of list.querySelectorAll(".cw-theme-star")) {
        const id = btn.parentElement.dataset.id; btn.classList.toggle("on", favs.includes(id));
      }
    }
    build();
    const onChange = () => build();
    document.addEventListener("cthulhu-theme-change", onChange);
    ctx.onCleanup(() => document.removeEventListener("cthulhu-theme-change", onChange));
  },
  configUI(panel, ctx) {
    panel.appendChild(ctx.ui.checkRow("Show a one-line mood next to each theme", ctx.config.showMood !== false,
      (v) => ctx.saveConfig({ ...ctx.config, showMood: v }, { refresh: true })));
    const note = document.createElement("div"); note.className = "cw-ui-note";
    note.textContent = "The theme itself is browser-wide (pref cthulhu.theme) and shared by every Theme tile.";
    panel.appendChild(note);
  },
});
