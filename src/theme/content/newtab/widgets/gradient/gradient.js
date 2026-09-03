/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Gradient widget (aesthetic). A slowly drifting three-stop gradient.
 *
 *   mode "theme"  -> stops are the live A2 tokens (accent / elevated / hover),
 *                    so it follows whatever theme the browser is on, live.
 *   mode "custom" -> three colours of your own, from the presets below, the
 *                    colour pickers, or typed hex.
 *
 * Angle and drift speed apply to both. Everything is a CSS variable on the
 * tile, so changing a colour never rebuilds the DOM. */
const _cthGradPresets = [
  { id: "sunset",  name: "Sunset",  colors: ["#ff7e5f", "#feb47b", "#ffd194"] },
  { id: "ocean",   name: "Ocean",   colors: ["#0f2027", "#2c5364", "#4ca1af"] },
  { id: "aurora",  name: "Aurora",  colors: ["#00c9ff", "#92fe9d", "#4b1fa3"] },
  { id: "candy",   name: "Candy",   colors: ["#ff9a9e", "#fad0c4", "#a18cd1"] },
  { id: "ember",   name: "Ember",   colors: ["#1a0f08", "#e08a4a", "#f0a05f"] },
  { id: "abyss",   name: "Abyss",   colors: ["#0b1416", "#134e4a", "#3ee8c0"] },
  { id: "mono",    name: "Mono",    colors: ["#111111", "#3a3a3a", "#e8e8e8"] },
];
CthulhuWidgets.register({
  id: "gradient",
  category: "aesthetic",
  name: "Gradient",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: { mode: "theme", colors: ["#ff7e5f", "#feb47b", "#ffd194"], angle: 135, speed: 9 },
  css: `
    .cw-gradient { width:100%; height:100%; border-radius:6px;
      --g1:var(--accent); --g2:var(--bg-elevated); --g3:var(--surface-hover); --g-angle:135deg; --g-speed:9s;
      background:linear-gradient(var(--g-angle), var(--g1), var(--g2), var(--g3));
      background-size:200% 200%; animation:cw-grad var(--g-speed) ease infinite; }
    @keyframes cw-grad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
  `,
  render(el, ctx) {
    const g = document.createElement("div"); g.className = "cw-gradient";
    const cfg = ctx.config || {};
    if (cfg.mode === "custom") {
      const c = (cfg.colors || []).map((v) => (ctx.theme && ctx.theme.color.isHex(v) ? v : null));
      g.style.setProperty("--g1", c[0] || "#ff7e5f");
      g.style.setProperty("--g2", c[1] || "#feb47b");
      g.style.setProperty("--g3", c[2] || "#ffd194");
    }
    g.style.setProperty("--g-angle", (Number.isFinite(+cfg.angle) ? +cfg.angle : 135) + "deg");
    g.style.setProperty("--g-speed", Math.max(1, +cfg.speed || 9) + "s");
    el.appendChild(g);
  },
  configUI(panel, ctx) {
    const cfg = () => ctx.config || {};
    const save = (patch) => ctx.saveConfig({ ...cfg(), ...patch }, { refresh: true });

    panel.appendChild(ctx.ui.checkRow("Follow the browser theme", cfg().mode !== "custom",
      (v) => save({ mode: v ? "theme" : "custom" })));

    const custom = ctx.ui.field("Custom colours");
    custom.appendChild(ctx.ui.swatches(_cthGradPresets, null, (p) => save({ mode: "custom", colors: p.colors.slice() })));
    ["Start", "Middle", "End"].forEach((label, i) => {
      custom.appendChild(ctx.ui.colorRow(label, (cfg().colors || [])[i] || "#ffffff", (hex) => {
        const colors = (cfg().colors || ["#ff7e5f", "#feb47b", "#ffd194"]).slice(); colors[i] = hex;
        save({ mode: "custom", colors });
      }));
    });
    panel.appendChild(custom);

    panel.appendChild(ctx.ui.rangeRow("Angle", { min: 0, max: 360, step: 5, value: cfg().angle ?? 135, unit: "°" },
      (v) => save({ angle: v })));
    panel.appendChild(ctx.ui.rangeRow("Drift", { min: 2, max: 30, step: 1, value: cfg().speed ?? 9, unit: "s" },
      (v) => save({ speed: v })));
  },
});
