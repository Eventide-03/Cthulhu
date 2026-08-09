/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folder widget (utility). Holds a list of links -- and other folders,
 * nested arbitrarily deep, like a file directory. The grid tile is just an
 * icon (with a small preview of its first few contents) + a name; clicking
 * it opens a scrollable browser/editor overlay for whichever folder is
 * currently open (root, or a nested one navigated into), with a back button
 * to go up a level. Adding/removing links and sub-folders, and renaming the
 * open folder, all happen inline in that overlay -- there's no separate
 * configUI popover.
 *
 * Data model (all in ctx.config, persisted like any other widget):
 *   { name: "Folder", items: [
 *       { type: "link",   url, label },
 *       { type: "folder", name, items: [...] },
 *       ...
 *   ] }
 */

const _cthFolderFaviconCache = Object.create(null); // host -> data URL (session cache)
async function _cthFolderFetchFavicon(host) {
  if (_cthFolderFaviconCache[host]) return _cthFolderFaviconCache[host];
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
      if (blob.size < 80) continue;
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(blob);
      });
      if (dataUrl) { _cthFolderFaviconCache[host] = dataUrl; return dataUrl; }
    } catch (e) {}
  }
  return null;
}
function _cthFolderNormalizeUrl(v) {
  v = (v || "").trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // already absolute
  if (/^(mailto|tel|about|chrome|file):/i.test(v)) return v; // schemeless-but-valid
  return "https://" + v;
}

/* Browser/editor overlay: a path of indices into nested `items` arrays,
 * walked from the widget's own root config. One modal instance, re-rendered
 * in place for every navigation/add/remove -- reused for the top-level open
 * and for every "open this sub-folder" click. Only one is ever open at once
 * (matches the config-modal/image-picker singleton-overlay convention). */
function openFolderBrowser(ctx) {
  const existing = document.querySelector(".cthulhu-folder-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "cthulhu-folder-modal";
  const panel = document.createElement("div");
  panel.className = "cthulhu-folder-panel";
  overlay.appendChild(panel);

  let path = []; // indices into nested items, root = []

  function currentFolder() {
    let f = ctx.config;
    for (const i of path) f = f.items[i];
    return f;
  }
  function persist() {
    ctx.saveConfig({ ...ctx.config }, { refresh: true }); // refresh: keep the tile's preview icons in sync live
  }

  function draw() {
    panel.innerHTML = "";
    const folder = currentFolder();
    const items = folder.items || (folder.items = []);

    const head = document.createElement("div");
    head.className = "cw-folder-head";
    if (path.length) {
      const back = document.createElement("button");
      back.type = "button"; back.className = "cw-folder-back"; back.textContent = "‹";
      back.title = "Back";
      back.addEventListener("click", () => { path.pop(); draw(); });
      head.appendChild(back);
    }
    const title = document.createElement("input");
    title.type = "text";
    title.className = "cw-folder-title";
    title.value = folder.name || "Folder";
    title.addEventListener("change", () => { folder.name = title.value.trim() || "Folder"; persist(); });
    head.appendChild(title);
    const close = document.createElement("button");
    close.type = "button"; close.className = "cw-folder-close"; close.textContent = "×";
    close.title = "Close";
    close.addEventListener("click", () => overlay.remove());
    head.appendChild(close);
    panel.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cw-folder-grid";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "cw-folder-empty";
      empty.textContent = "Empty — add a link or folder below.";
      grid.appendChild(empty);
    }
    items.forEach((it, i) => {
      const tile = document.createElement("div");
      tile.className = "cw-folder-item";

      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "cw-folder-item-remove"; remove.textContent = "×";
      remove.title = "Remove";
      remove.addEventListener("click", (e) => { e.stopPropagation(); items.splice(i, 1); persist(); draw(); });
      tile.appendChild(remove);

      const iconEl = document.createElement("div");
      iconEl.className = "cw-folder-item-icon";
      const lbl = document.createElement("div");
      lbl.className = "cw-folder-item-label";

      if (it.type === "folder") {
        iconEl.classList.add("cw-folder-item-subfolder");
        lbl.textContent = it.name || "Folder";
        tile.addEventListener("click", () => { path.push(i); draw(); });
      } else {
        const url = _cthFolderNormalizeUrl(it.url);
        let host = "";
        try { host = new URL(url).hostname; } catch (e) {}
        iconEl.style.backgroundSize = "cover";
        iconEl.style.backgroundPosition = "center";
        if (host) _cthFolderFetchFavicon(host).then((d) => { if (d) iconEl.style.backgroundImage = 'url("' + d + '")'; });
        lbl.textContent = it.label || host || url;
        tile.addEventListener("click", () => { overlay.remove(); ctx.openLink(url); });
      }
      tile.append(iconEl, lbl);
      grid.appendChild(tile);
    });
    panel.appendChild(grid);

    const toolbar = document.createElement("div");
    toolbar.className = "cw-folder-toolbar";
    const addLinkBtn = document.createElement("button");
    addLinkBtn.type = "button"; addLinkBtn.textContent = "+ Link";
    addLinkBtn.addEventListener("click", () => showAddForm("link"));
    const addFolderBtn = document.createElement("button");
    addFolderBtn.type = "button"; addFolderBtn.textContent = "+ Folder";
    addFolderBtn.addEventListener("click", () => showAddForm("folder"));
    toolbar.append(addLinkBtn, addFolderBtn);
    panel.appendChild(toolbar);

    function showAddForm(kind) {
      toolbar.remove();
      const form = document.createElement("div");
      form.className = "cw-folder-add-form";
      let urlInput = null;
      if (kind === "link") {
        urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.placeholder = "URL";
        form.appendChild(urlInput);
      }
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = kind === "folder" ? "Folder name" : "Label (optional)";
      form.appendChild(nameInput);

      const actions = document.createElement("div");
      actions.className = "cw-folder-add-actions";
      const save = document.createElement("button");
      save.type = "button"; save.className = "cw-folder-add-save"; save.textContent = "Add";
      const doSave = () => {
        if (kind === "folder") {
          const name = nameInput.value.trim();
          if (!name) return;
          items.push({ type: "folder", name, items: [] });
        } else {
          const url = _cthFolderNormalizeUrl(urlInput.value);
          if (!url) return;
          items.push({ type: "link", url, label: nameInput.value.trim() });
        }
        persist();
        draw();
      };
      save.addEventListener("click", doSave);
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "cw-folder-add-cancel"; cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => draw());
      actions.append(save, cancel);
      form.appendChild(actions);
      form.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSave(); } });
      panel.appendChild(form);
      (urlInput || nameInput).focus();
    }
  }

  draw();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

CthulhuWidgets.register({
  id: "folder",
  category: "utility",
  name: "Folder",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: { name: "Folder", items: [] },
  css: `
    .cw-folder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
      height:100%; cursor:pointer; user-select:none; }
    .cw-folder-icon { position:relative; width:56px; height:42px; margin-top:10px;
      background:var(--accent); border-radius:5px; }
    .cw-folder-icon::before { content:""; position:absolute; top:-8px; left:4px; width:24px; height:9px;
      background:var(--accent); border-radius:4px 4px 0 0; }
    .cw-folder-preview { position:absolute; inset:7px 5px 5px; display:grid;
      grid-template-columns:1fr 1fr; grid-auto-rows:1fr; gap:2px; }
    .cw-folder-mini { border-radius:2px; background-color:color-mix(in srgb, var(--fg-on-accent) 55%, transparent);
      background-size:cover; background-position:center; }
    .cw-folder-label { font-size:1em; color:var(--fg); text-align:center; word-break:break-word; }
    .cw-folder:hover .cw-folder-label { color:var(--accent); }

    .cthulhu-folder-modal { position:fixed; inset:0; z-index:380; display:flex; align-items:center;
      justify-content:center; background:rgba(0,0,0,.5); }
    .cthulhu-folder-panel { width:520px; max-width:calc(100vw - 40px); max-height:calc(100vh - 40px);
      box-sizing:border-box; display:flex; flex-direction:column; background:var(--bg-elevated);
      border:1px solid var(--border); border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.5); overflow:hidden; }
    .cw-folder-head { flex:none; display:flex; align-items:center; gap:8px; padding:12px 14px;
      border-bottom:1px solid var(--border); }
    .cw-folder-back { background:transparent; border:none; color:var(--fg-muted); cursor:pointer;
      font-family:var(--font-pixel); font-size:1.1em; padding:2px 6px; }
    .cw-folder-back:hover { color:var(--accent); }
    .cw-folder-title { flex:1; min-width:0; font-family:var(--font-pixel); font-size:1.05em; color:var(--fg);
      background:transparent; border:1px solid transparent; border-radius:4px; padding:3px 6px; outline:none; }
    .cw-folder-title:hover, .cw-folder-title:focus { border-color:var(--border); }
    .cw-folder-close { background:transparent; border:none; color:var(--fg-muted); cursor:pointer;
      font-size:16px; line-height:1; padding:2px 6px; }
    .cw-folder-close:hover { color:var(--accent); }
    .cw-folder-grid { flex:1; min-height:120px; max-height:50vh; overflow-y:auto; display:flex;
      flex-wrap:wrap; gap:10px; padding:14px; align-content:flex-start; }
    .cw-folder-item { position:relative; width:84px; display:flex; flex-direction:column; align-items:center;
      gap:4px; padding:8px 4px; border-radius:8px; cursor:pointer; }
    .cw-folder-item:hover { background:var(--surface-hover); }
    .cw-folder-item-icon { width:36px; height:36px; border-radius:8px; background-color:var(--surface); }
    .cw-folder-item-icon.cw-folder-item-subfolder { position:relative; background-color:var(--accent); }
    .cw-folder-item-icon.cw-folder-item-subfolder::before { content:""; position:absolute; top:-5px; left:3px;
      width:16px; height:6px; background:var(--accent); border-radius:3px 3px 0 0; }
    .cw-folder-item-label { font-size:.85em; color:var(--fg); text-align:center; word-break:break-word;
      line-height:1.2; max-height:2.4em; overflow:hidden; }
    .cw-folder-item-remove { position:absolute; top:2px; right:2px; width:16px; height:16px; display:none;
      place-items:center; border-radius:50%; background:var(--bg-elevated); border:1px solid var(--border);
      color:var(--fg-muted); font-size:11px; line-height:1; cursor:pointer; }
    .cw-folder-item:hover .cw-folder-item-remove { display:grid; }
    .cw-folder-item-remove:hover { color:var(--accent); border-color:var(--accent); }
    .cw-folder-empty { color:var(--fg-muted); font-size:.9em; padding:20px; text-align:center; width:100%; }
    .cw-folder-toolbar { flex:none; display:flex; gap:8px; padding:10px 14px; border-top:1px solid var(--border); }
    .cw-folder-toolbar button { flex:1; padding:7px 10px; background:var(--surface); color:var(--fg);
      border:1px solid var(--border); border-radius:6px; font-family:var(--font-pixel); font-size:.85em;
      cursor:pointer; }
    .cw-folder-toolbar button:hover { border-color:var(--accent); color:var(--accent); }
    .cw-folder-add-form { flex:none; display:flex; flex-direction:column; gap:6px; padding:10px 14px;
      border-top:1px solid var(--border); }
    .cw-folder-add-form input { box-sizing:border-box; width:100%; padding:6px 8px; background:var(--bg);
      border:1px solid var(--border); border-radius:4px; color:var(--fg); font-family:var(--font-pixel);
      font-size:.85em; outline:none; }
    .cw-folder-add-form input:focus { border-color:var(--accent); }
    .cw-folder-add-actions { display:flex; gap:6px; }
    .cw-folder-add-actions button { flex:1; padding:6px 10px; border-radius:4px; font-family:var(--font-pixel);
      font-size:.85em; cursor:pointer; }
    .cw-folder-add-save { background:var(--accent); color:var(--fg-on-accent); border:none; }
    .cw-folder-add-cancel { background:transparent; color:var(--fg-muted); border:1px solid var(--border); }
  `,
  // Same reason quick-links needs both: GridStack starts a real drag on any
  // pointer movement (its click swallows the native `click`), so onClick is
  // the reliable path for a jittery real-world click; a zero-movement click
  // never engages GridStack's drag machinery at all, so it falls through to
  // the native click below instead (same fix as quick-links' unset-link
  // case, just unconditional here since the tile always opens the browser).
  onClick(ctx) { openFolderBrowser(ctx); },
  render(el, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "cw-folder";

    const icon = document.createElement("div");
    icon.className = "cw-folder-icon";
    const preview = document.createElement("div");
    preview.className = "cw-folder-preview";
    const items = ctx.config.items || [];
    for (let i = 0; i < Math.min(4, items.length); i++) {
      const mini = document.createElement("div");
      mini.className = "cw-folder-mini";
      const it = items[i];
      if (it.type === "link") {
        const url = _cthFolderNormalizeUrl(it.url);
        let host = "";
        try { host = new URL(url).hostname; } catch (e) {}
        if (host) _cthFolderFetchFavicon(host).then((d) => { if (d) mini.style.backgroundImage = 'url("' + d + '")'; });
      }
      preview.appendChild(mini);
    }
    icon.appendChild(preview);

    const label = document.createElement("div");
    label.className = "cw-folder-label";
    label.textContent = ctx.config.name || "Folder";

    wrap.append(icon, label);
    wrap.addEventListener("click", () => openFolderBrowser(ctx));
    el.appendChild(wrap);
  },
});
