/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Quick-link widget (utility). One site as a clickable tile showing its logo —
 * the site's favicon by default, or a custom image (recent files / clipboard).
 * The favicon is FETCHED and inlined as a data URL: a remote <img src> is
 * blocked on this privileged (system-principal) page, but a system-principal
 * fetch is not, so we fetch the bytes and set them inline. */

// A bare host ("discord.com") isn't a navigable/absolute URL -- an <a href>
// would resolve it relative to this page instead of the real site, and
// `new URL()` throws so the favicon never loads either. Add "https://" when
// there's no scheme. Applied both where the URL is entered (configUI, so
// typing "discord.com" becomes "https://discord.com") and where it's
// consumed (render/onClick, so an already-saved bare host from before this
// fix still works without the widget needing to be re-saved).
function _cthNormalizeUrl(v) {
  v = (v || "").trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // already absolute (http://, https://, ...)
  if (/^(mailto|tel|about|chrome|file):/i.test(v)) return v; // schemeless-but-valid
  return "https://" + v;
}

const _cthFaviconCache = Object.create(null); // host -> dataURL (session cache)

async function _cthFetchFavicon(host) {
  if (_cthFaviconCache[host]) return _cthFaviconCache[host];
  const sources = [
    "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64",
    "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico",
    "https://" + host + "/favicon.ico",
  ];
  for (const u of sources) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (blob.size < 80) continue; // skip empty / 1x1 placeholders
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(blob);
      });
      if (dataUrl) { _cthFaviconCache[host] = dataUrl; return dataUrl; }
    } catch (e) {}
  }
  return null;
}

CthulhuWidgets.register({
  id: "quick-links",
  category: "utility",
  name: "Quick Link",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: { url: "", label: "", image: "" },
  css: `
    .cw-ql { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      height:100%; text-decoration:none; color:var(--fg); }
    .cw-ql-logo { width:48px; height:48px; object-fit:contain; border-radius:10px; }
    .cw-ql-label { font-size:1em; color:var(--fg); text-align:center; word-break:break-word; }
    .cw-ql:hover .cw-ql-label { color:var(--accent); }
    .cw-ql-imgrow { display:flex; gap:6px; flex-wrap:wrap; }
    .cw-cfg-secondary { background:transparent !important; color:var(--fg-muted) !important; border:1px solid var(--border) !important; }
    .cw-ql-field { display:flex; flex-direction:column; align-items:stretch; gap:3px; }
  `,
  // GridStack drag-enables the whole tile so it can be repositioned (see
  // newtab.js draggable.cancel), which means it starts a real drag on the very
  // first pointer movement and swallows the anchor's native click before
  // navigation ever fires (confirmed live: any click jitter routes the
  // mouseup to GridStack's drag placeholder, not the link). The core detects
  // "dragged then dropped in the same cell" and calls this instead -- this is
  // the ONLY reliable way this tile navigates on click; don't reintroduce a
  // plain click listener for it. `a.href` stays set for keyboard Enter/Space
  // activation and right-click "Copy Link"/"Open in New Tab", neither of
  // which goes through GridStack's drag detection.
  onClick(ctx) {
    const url = _cthNormalizeUrl(ctx.config.url);
    if (!url) { ctx.openConfig(); return; }
    location.href = url;
  },
  render(el, ctx) {
    const url = _cthNormalizeUrl(ctx.config.url);
    let host = "";
    try { host = new URL(url).hostname; } catch (e) {}

    const a = document.createElement("a");
    a.className = "cw-ql";
    a.href = url || "#";
    a.draggable = false; // don't native-drag the link; let GridStack move the widget

    const logo = document.createElement("img");
    logo.className = "cw-ql-logo";
    logo.alt = "";
    logo.draggable = false;
    logo.addEventListener("error", () => logo.remove());
    if (ctx.config.image) {
      logo.src = ctx.config.image; // custom image (data URL)
      a.appendChild(logo);
    } else if (host) {
      a.appendChild(logo);
      _cthFetchFavicon(host).then((d) => { if (d) logo.src = d; else logo.remove(); });
    }

    const label = document.createElement("div");
    label.className = "cw-ql-label";
    label.textContent = ctx.config.label || host || "Set a link ⚙";
    a.appendChild(label);
    el.appendChild(a);
  },
  configUI(el, ctx) {
    const cfg = { ...ctx.config };
    const field = (labelText, val, onInput, opts) => {
      const wrap = document.createElement("label");
      wrap.className = "cw-ql-field";
      wrap.appendChild(document.createTextNode(labelText));
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = val || "";
      inp.addEventListener("input", () => onInput(inp.value));
      if (opts && opts.normalize) {
        // Normalize on blur (not on every keystroke) so typing "discord.com"
        // isn't rewritten mid-word; the field visibly updates to the full
        // URL as soon as focus leaves it, before Save is ever clicked.
        inp.addEventListener("blur", () => {
          inp.value = opts.normalize(inp.value);
          onInput(inp.value);
        });
      }
      wrap.appendChild(inp);
      return wrap;
    };
    el.appendChild(field("URL", cfg.url, (v) => { cfg.url = v; }, { normalize: _cthNormalizeUrl }));
    el.appendChild(field("Label (optional)", cfg.label, (v) => { cfg.label = v; }));

    const row = document.createElement("div"); row.className = "cw-ql-imgrow";
    const choose = document.createElement("button");
    choose.type = "button"; choose.className = "cw-cfg-save";
    choose.textContent = cfg.image ? "Change image" : "Choose image…";
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "cw-cfg-save cw-cfg-secondary";
    clear.textContent = "Use site logo";
    clear.style.display = cfg.image ? "" : "none";
    choose.addEventListener("click", async () => {
      const d = await ctx.pickImage();
      if (d) { cfg.image = d; choose.textContent = "Change image"; clear.style.display = ""; }
    });
    clear.addEventListener("click", () => {
      cfg.image = "";
      cfg.url = _cthNormalizeUrl(cfg.url); // defensive: in case blur never fired
      // Apply immediately (unlike "Choose image", this is a single, complete
      // action with nothing else to adjust first) so clicking it has a visible
      // effect right away, instead of silently staging a change that's easy to
      // mistake for doing nothing until a separate Save click.
      ctx.saveConfig({ ...cfg }, { refresh: true });
      ctx.closeConfig();
    });
    row.appendChild(choose); row.appendChild(clear);
    el.appendChild(row);

    const save = document.createElement("button");
    save.type = "button"; save.className = "cw-cfg-save"; save.textContent = "Save";
    const doSave = () => {
      cfg.url = _cthNormalizeUrl(cfg.url); // defensive: in case blur never fired
      ctx.saveConfig({ ...cfg }, { refresh: true });
      ctx.closeConfig(); // dismiss the config modal after saving
    };
    save.addEventListener("click", doSave);
    el.appendChild(save);

    // Enter in either text field saves & closes, like a normal form submit.
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSave(); }
    });
  },
});
