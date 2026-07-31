/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Quick-link widget (utility). One site as a clickable tile showing its logo —
 * the site's favicon by default, or a custom image (recent files / clipboard).
 * The favicon is FETCHED and inlined as a data URL: a remote <img src> is
 * blocked on this privileged (system-principal) page, but a system-principal
 * fetch is not, so we fetch the bytes and set them inline. */

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
  render(el, ctx) {
    const url = ctx.config.url || "";
    let host = "";
    try { host = new URL(url).hostname; } catch (e) {}

    const a = document.createElement("a");
    a.className = "cw-ql";
    a.href = url || "#";
    a.draggable = false; // don't native-drag the link; let GridStack move the widget
    if (!url) {
      a.addEventListener("click", (e) => { e.preventDefault(); ctx.openConfig(); });
    }

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
    const field = (labelText, val, onInput) => {
      const wrap = document.createElement("label");
      wrap.className = "cw-ql-field";
      wrap.appendChild(document.createTextNode(labelText));
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = val || "";
      inp.addEventListener("input", () => onInput(inp.value));
      wrap.appendChild(inp);
      return wrap;
    };
    el.appendChild(field("URL", cfg.url, (v) => { cfg.url = v; }));
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
    clear.addEventListener("click", () => { cfg.image = ""; choose.textContent = "Choose image…"; clear.style.display = "none"; });
    row.appendChild(choose); row.appendChild(clear);
    el.appendChild(row);

    const save = document.createElement("button");
    save.type = "button"; save.className = "cw-cfg-save"; save.textContent = "Save";
    save.addEventListener("click", () => {
      ctx.saveConfig({ ...cfg }, { refresh: true });
      ctx.closeConfig(); // dismiss the config modal after saving
    });
    el.appendChild(save);
  },
});
