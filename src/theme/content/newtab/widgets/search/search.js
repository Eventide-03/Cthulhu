/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Search-box widget (utility). Submits the query to a configurable engine.
 * Form controls via createElement (chrome innerHTML strips <input>/<form>). */
CthulhuWidgets.register({
  id: "search",
  category: "utility",
  name: "Search",
  defaultSize: { w: 4, h: 1 },
  defaultConfig: { engine: "https://duckduckgo.com/?q=" },
  css: `
    .cw-search { display:flex; align-items:center; height:100%; }
    .cw-search input { flex:1; box-sizing:border-box; padding:9px 12px; background:var(--bg-elevated);
      border:1px solid var(--border); border-radius:8px; color:var(--fg); font-family:var(--font-pixel);
      font-size:1em; outline:none; }
    .cw-search input:focus { border-color:var(--accent); }
    .cw-search input::placeholder { color:var(--fg-muted); }
  `,
  render(el, ctx) {
    const form = document.createElement("form");
    form.className = "cw-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "search the web…";
    input.setAttribute("aria-label", "Search the web");
    form.appendChild(input);
    el.appendChild(form);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) location.href = (ctx.config.engine || "https://duckduckgo.com/?q=") + encodeURIComponent(q);
    });
  },
});
