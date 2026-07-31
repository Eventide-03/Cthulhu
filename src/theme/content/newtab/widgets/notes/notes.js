/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Sticky-note widget (utility). Free text, persisted as config (no refresh on
 * keystroke so the caret is never lost). createElement — see other widgets. */
CthulhuWidgets.register({
  id: "notes",
  category: "utility",
  name: "Sticky Note",
  defaultSize: { w: 3, h: 2 },
  defaultConfig: { text: "" },
  css: `
    .cw-notes { width:100%; height:100%; box-sizing:border-box; resize:none; border:none; outline:none;
      background:transparent; color:var(--fg); font-family:var(--font-pixel); font-size:1em; line-height:1.4; }
    .cw-notes::placeholder { color:var(--fg-muted); }
  `,
  render(el, ctx) {
    const ta = document.createElement("textarea");
    ta.className = "cw-notes";
    ta.placeholder = "notes…";
    ta.spellcheck = false;
    ta.value = ctx.config.text || "";
    ta.addEventListener("input", () => ctx.saveConfig({ ...ctx.config, text: ta.value }));
    el.appendChild(ta);
  },
});
