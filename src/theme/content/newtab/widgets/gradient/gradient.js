/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Gradient widget (aesthetic). A slowly drifting gradient built from A2 tokens
 * — a simple non-sprite aesthetic placeholder. */
CthulhuWidgets.register({
  id: "gradient",
  category: "aesthetic",
  name: "Gradient",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: {},
  css: `
    .cw-gradient { width:100%; height:100%; border-radius:6px;
      background:linear-gradient(135deg, var(--accent), var(--bg-elevated), var(--surface-hover));
      background-size:200% 200%; animation:cw-grad 9s ease infinite; }
    @keyframes cw-grad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
  `,
  render(el) {
    el.innerHTML = '<div class="cw-gradient"></div>';
  },
});
