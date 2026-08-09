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
    /* A textarea has to stay excluded from GridStack's drag detection (so
       clicking/dragging inside it selects text instead of moving the widget)
       -- which leaves nothing else to grab if it fills the whole widget. This
       handle strip is plain (non-canceled) content above it: a real grabbable
       area, styled like a sticky note's little tab. */
    .cw-notes-handle { height:14px; width:100%; cursor:grab; background:var(--surface-hover);
      border-radius:4px 4px 0 0; }
    .cw-notes { width:100%; height:calc(100% - 14px); box-sizing:border-box; resize:none; border:none; outline:none;
      background:transparent; color:var(--fg); font-family:var(--font-pixel); font-size:1em; line-height:1.4; }
    .cw-notes::placeholder { color:var(--fg-muted); }
  `,
  render(el, ctx) {
    const handle = document.createElement("div");
    handle.className = "cw-notes-handle";
    handle.title = "Drag to move";
    el.appendChild(handle);

    const ta = document.createElement("textarea");
    ta.className = "cw-notes";
    ta.placeholder = "notes…";
    ta.spellcheck = false;
    ta.value = ctx.config.text || "";
    ta.addEventListener("input", () => ctx.saveConfig({ ...ctx.config, text: ta.value }));
    el.appendChild(ta);
  },
});
