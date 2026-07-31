/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Moon-phase widget (aesthetic). Shows the current phase (computed locally, no
 * API) using the shared 8-frame moon strip. The clock widget can also show the
 * moon via its config; this is the standalone version. */
CthulhuWidgets.register({
  id: "moon",
  category: "aesthetic",
  name: "Moon Phase",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: {},
  css: `
    .cw-moon { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:10px; }
    .cw-moon-name { color:var(--fg-muted); font-size:.9em; text-align:center; }
  `,
  render(el, ctx) {
    const phase = ctx.moon.moonPhase();
    const wrap = document.createElement("div");
    wrap.className = "cw-moon";
    wrap.appendChild(ctx.moon.moonEl(new Date(), 72));
    const name = document.createElement("div");
    name.className = "cw-moon-name";
    name.textContent = phase.name;
    wrap.appendChild(name);
    el.appendChild(wrap);
  },
});
