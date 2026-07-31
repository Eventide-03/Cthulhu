/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Clock widget (utility). Live time + date; config toggles 12/24-hour and an
 * optional moon-phase readout. NOTE: form controls are built with createElement,
 * not innerHTML — this privileged (chrome) document sanitizes <input> out of
 * innerHTML, so createElement is the only reliable way to add form fields. */
CthulhuWidgets.register({
  id: "clock",
  category: "utility",
  name: "Clock",
  defaultSize: { w: 3, h: 2 },
  defaultConfig: { format24: false, showMoon: false },
  css: `
    .cw-clock { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:4px; }
    .cw-clock-time { font-size:2.4em; color:var(--fg); font-variant-numeric:tabular-nums; }
    .cw-clock-date { font-size:.95em; color:var(--fg-muted); }
    .cw-clock-moon { margin-top:4px; }
  `,
  render(el, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "cw-clock";
    const t = document.createElement("div"); t.className = "cw-clock-time";
    const d = document.createElement("div"); d.className = "cw-clock-date";
    wrap.appendChild(t); wrap.appendChild(d);
    if (ctx.config.showMoon) {
      const moon = ctx.moon.moonEl(new Date(), 28);
      moon.classList.add("cw-clock-moon");
      wrap.appendChild(moon);
    }
    el.appendChild(wrap);

    const tick = () => {
      const now = new Date();
      let h = now.getHours();
      const m = String(now.getMinutes()).padStart(2, "0");
      let suffix = "";
      if (!ctx.config.format24) { suffix = h < 12 ? " AM" : " PM"; h = h % 12 || 12; }
      t.textContent = h + ":" + m + suffix;
      d.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    };
    tick();
    const iv = setInterval(tick, 1000);
    ctx.onCleanup(() => clearInterval(iv));
  },
  configUI(el, ctx) {
    const row = (text, checked, onChange) => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!checked;
      cb.addEventListener("change", () => onChange(cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + text));
      return label;
    };
    el.appendChild(row("Tea's Time", ctx.config.format24, (v) =>
      ctx.saveConfig({ ...ctx.config, format24: v }, { refresh: true })));
    el.appendChild(row("Show moon phase", ctx.config.showMoon, (v) =>
      ctx.saveConfig({ ...ctx.config, showMoon: v }, { refresh: true })));
  },
});
