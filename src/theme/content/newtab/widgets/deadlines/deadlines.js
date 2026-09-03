/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Deadlines widget (utility). Assignments and crits with a countdown, sorted by
 * what is due first. Local to this tile (no account), unlike the shared Google
 * calendar. Under 2 days turns red; done items sink to the bottom. */
CthulhuWidgets.register({
  id: "deadlines",
  category: "utility",
  name: "Deadlines",
  defaultSize: { w: 3, h: 3 },
  defaultConfig: { items: [], showDone: true },
  css: `
    .cw-dl { display:flex; flex-direction:column; height:100%; gap:6px; }
    .cw-dl-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
    .cw-dl-row { display:flex; align-items:center; gap:7px; font-size:.85em; padding:3px 4px; border-radius:5px; }
    .cw-dl-row:hover { background:var(--surface-hover); }
    .cw-dl-row input[type=checkbox] { flex:none; margin:0; accent-color:var(--accent); }
    .cw-dl-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); }
    .cw-dl-row.done .cw-dl-title { text-decoration:line-through; color:var(--fg-muted); }
    .cw-dl-when { flex:none; font-size:.85em; color:var(--accent); font-variant-numeric:tabular-nums; }
    .cw-dl-row.soon .cw-dl-when { color:var(--notify); }
    .cw-dl-row.done .cw-dl-when { color:var(--fg-muted); }
    .cw-dl-x { flex:none; border:none; background:transparent; color:var(--fg-muted); cursor:pointer; padding:0 2px; line-height:1; }
    .cw-dl-x:hover { color:var(--notify); }
    .cw-dl-add { display:flex; gap:5px; flex:none; }
    .cw-dl-add input { min-width:0; background:var(--bg); color:var(--fg); border:1px solid var(--border); border-radius:5px;
      font-family:var(--font-pixel); font-size:.8em; padding:3px 5px; }
    .cw-dl-add input[type=text] { flex:1; }
    .cw-dl-add input:focus { border-color:var(--accent); outline:none; }
    .cw-dl-add button { flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg); border-radius:5px;
      cursor:pointer; font-family:var(--font-pixel); font-size:11px; padding:3px 7px; }
    .cw-dl-add button:hover { border-color:var(--accent); }
    .cw-dl-empty { color:var(--fg-muted); font-size:.85em; }
  `,
  render(el, ctx) {
    const root = document.createElement("div"); root.className = "cw-dl";
    const list = document.createElement("div"); list.className = "cw-dl-list";
    const items = (ctx.config.items || []).slice();
    const dayMs = 86400000;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const daysLeft = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Math.round((new Date(y, m - 1, d) - startOfToday) / dayMs); };
    items.sort((a, b) => (a.done - b.done) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const shown = items.filter((it) => ctx.config.showDone !== false || !it.done);
    if (!shown.length) { const e = document.createElement("div"); e.className = "cw-dl-empty"; e.textContent = "Nothing due. Add one below."; list.appendChild(e); }
    for (const it of shown) {
      const row = document.createElement("div"); row.className = "cw-dl-row" + (it.done ? " done" : "");
      const n = daysLeft(it.due);
      if (!it.done && n <= 2) row.classList.add("soon");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!it.done;
      cb.addEventListener("change", () => ctx.saveConfig({ ...ctx.config, items: ctx.config.items.map((q) => (q.id === it.id ? { ...q, done: cb.checked } : q)) }, { refresh: true }));
      const t = document.createElement("span"); t.className = "cw-dl-title"; t.textContent = it.title; t.title = it.title + " · " + it.due;
      const w = document.createElement("span"); w.className = "cw-dl-when";
      w.textContent = it.done ? "done" : n < 0 ? (-n) + "d late" : n === 0 ? "today" : n === 1 ? "tomorrow" : n + "d";
      const x = document.createElement("button"); x.type = "button"; x.className = "cw-dl-x"; x.textContent = "×"; x.title = "Remove";
      x.addEventListener("click", () => ctx.saveConfig({ ...ctx.config, items: ctx.config.items.filter((q) => q.id !== it.id) }, { refresh: true }));
      row.appendChild(cb); row.appendChild(t); row.appendChild(w); row.appendChild(x); list.appendChild(row);
    }
    root.appendChild(list);

    const add = document.createElement("form"); add.className = "cw-dl-add";
    const title = document.createElement("input"); title.type = "text"; title.placeholder = "What's due…"; title.required = true;
    const due = document.createElement("input"); due.type = "date"; due.required = true;
    const go = document.createElement("button"); go.type = "submit"; go.textContent = "Add";
    add.appendChild(title); add.appendChild(due); add.appendChild(go);
    add.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!title.value.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(due.value)) return;
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title.value.trim(), due: due.value, done: false };
      ctx.saveConfig({ ...ctx.config, items: [...(ctx.config.items || []), item] }, { refresh: true });
    });
    root.appendChild(add); el.appendChild(root);
  },
  configUI(panel, ctx) {
    panel.appendChild(ctx.ui.checkRow("Keep finished items visible", ctx.config.showDone !== false, (v) => ctx.saveConfig({ ...ctx.config, showDone: v }, { refresh: true })));
    panel.appendChild(ctx.ui.button("Clear finished", () => { ctx.saveConfig({ ...ctx.config, items: (ctx.config.items || []).filter((q) => !q.done) }, { refresh: true }); ctx.closeConfig(); }));
  },
});
