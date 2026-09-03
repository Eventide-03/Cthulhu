/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Cthulhu home widget system.
 *
 *   window.CthulhuWidgets — registry each widget self-registers into (+ shared
 *     moon-phase helpers). See widgets/README.md.
 *   window.CthulhuHome — the page app: auto-builds the palette, drag/drop from
 *     palette onto the GridStack grid, remove, per-widget config, and persistence.
 *
 * Two modes, chosen from the URL hash:
 *   about:cthulhu       -> "newtab" layout, SHARED across all new tabs (synced).
 *   about:cthulhu#home  -> "home"   layout, its own separate grid.
 * Both persist to IndexedDB (localStorage is unavailable on this principal).
 * ============================================================================= */
"use strict";

/* --------------------------------- registry -------------------------------- */
window.CthulhuWidgets = (function () {
  const defs = new Map();
  let styleEl = null;
  function injectCss(css) {
    if (!css) return;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "cthulhu-widget-styles";
      document.head.appendChild(styleEl);
    }
    styleEl.appendChild(document.createTextNode("\n" + css));
  }
  const MOON_NAMES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
    "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  return {
    register(def) {
      if (!def || !def.id) return console.error("[Cthulhu] widget missing id", def);
      if (defs.has(def.id)) console.warn("[Cthulhu] widget re-registered:", def.id);
      defs.set(def.id, def);
      injectCss(def.css);
    },
    get(id) { return defs.get(id); },
    all() { return [...defs.values()]; },
    byCategory() {
      const cats = {};
      for (const d of defs.values()) (cats[d.category || "other"] ||= []).push(d);
      return cats;
    },
    /** Local moon-phase from the synodic age (no API). */
    moonPhase(date) {
      const SYN = 29.530588853, FRAMES = 8;
      const jd = (date || new Date()).getTime() / 86400000 + 2440587.5;
      let age = (jd - 2451550.1) % SYN;
      if (age < 0) age += SYN;
      const frac = age / SYN;
      const frame = Math.round(frac * FRAMES) % FRAMES;
      return { frac, frame, name: MOON_NAMES[frame], age };
    },
    /** A pixel moon element for `date`, sized to `size` px (uses the 8-frame strip). */
    moonEl(date, size) {
      size = size || 32;
      const p = this.moonPhase(date);
      const el = document.createElement("div");
      el.className = "cthulhu-moon";
      el.style.width = el.style.height = size + "px";
      el.style.backgroundImage = 'url("chrome://cthulhu/content/newtab/assets/moon.png")';
      el.style.backgroundSize = 8 * size + "px " + size + "px";
      el.style.backgroundPositionX = -(p.frame * size) + "px";
      el.style.imageRendering = "pixelated";
      el.title = p.name;
      return el;
    },
  };
})();

function cthEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ----------------------------------- app ----------------------------------- */
window.CthulhuHome = (function () {
  const BASE = "chrome://cthulhu/content/newtab/widgets/";
  const CATEGORY_ORDER = ["utility", "aesthetic"];
  const CATEGORY_LABEL = { utility: "Utility", aesthetic: "Aesthetic" };
  const DEFAULT_LAYOUT = [
    { widget: "clock", x: 0, y: 0, w: 3, h: 2, config: {} },
    { widget: "moon", x: 3, y: 0, w: 2, h: 2, config: {} },
  ];

  let grid = null;
  let saveTimer = null;
  let mode = "newtab";
  let bc = null;
  let suppressSave = false;
  let pendingReload = false;

  /* --- IndexedDB persistence (per-mode key) --- */
  const DB = "cthulhu-home", STORE = "kv";
  const key = () => "layout:" + mode;
  function withStore(txMode, fn) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (e) {} };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        let out = null;
        const tx = db.transaction(STORE, txMode);
        const r = fn(tx.objectStore(STORE));
        if (r) r.onsuccess = () => { out = r.result; };
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => { db.close(); resolve(null); };
      };
    });
  }
  const idbGet = () => withStore("readonly", (s) => s.get(key()));
  const idbSet = (v) => withStore("readwrite", (s) => { s.put(v, key()); return null; });
  const idbClear = () => withStore("readwrite", (s) => { s.delete(key()); return null; });

  /* --- image picker (Opera-GX-style: recent files + clipboard paste) --- */
  const REC_KEY = "recentImages";
  async function getRecents() {
    const r = await withStore("readonly", (s) => s.get(REC_KEY));
    return Array.isArray(r) ? r : [];
  }
  async function addRecent(dataUrl) {
    const list = await getRecents();
    const next = [dataUrl, ...list.filter((u) => u !== dataUrl)].slice(0, 8);
    await withStore("readwrite", (s) => { s.put(next, REC_KEY); return null; });
  }
  function fileToDataUrl(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  }
  async function readClipboardImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) return await fileToDataUrl(await it.getType(type));
      }
    } catch (e) { console.warn("[Cthulhu] clipboard read:", e.message); }
    return null;
  }
  /** Open the image picker; resolves to a data URL, or null if cancelled. */
  function pickImage() {
    return new Promise(async (resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "cthulhu-image-picker";
      const panel = document.createElement("div");
      panel.className = "cthulhu-image-picker-panel";
      overlay.appendChild(panel);
      const done = (val) => { overlay.remove(); resolve(val); };
      const pick = async (dataUrl) => { if (dataUrl) await addRecent(dataUrl); done(dataUrl || null); };

      const h = document.createElement("h3"); h.textContent = "Choose an image"; panel.appendChild(h);

      const recents = await getRecents();
      if (recents.length) {
        const rl = document.createElement("div"); rl.className = "cthulhu-ip-label"; rl.textContent = "Recent";
        const rgrid = document.createElement("div"); rgrid.className = "cthulhu-ip-recent";
        for (const url of recents) {
          const t = document.createElement("img"); t.className = "cthulhu-ip-thumb"; t.src = url;
          t.addEventListener("click", () => pick(url));
          rgrid.appendChild(t);
        }
        panel.appendChild(rl); panel.appendChild(rgrid);
      }

      const actions = document.createElement("div"); actions.className = "cthulhu-ip-actions";
      const paste = document.createElement("button"); paste.type = "button"; paste.className = "cthulhu-ip-btn"; paste.textContent = "Paste from clipboard";
      paste.addEventListener("click", async () => {
        const d = await readClipboardImage();
        if (d) pick(d);
        else { paste.textContent = "No image in clipboard"; setTimeout(() => { paste.textContent = "Paste from clipboard"; }, 1500); }
      });
      const browse = document.createElement("button"); browse.type = "button"; browse.className = "cthulhu-ip-btn"; browse.textContent = "Browse files…";
      const file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.style.display = "none";
      file.addEventListener("change", async () => { const f = file.files[0]; if (f) pick(await fileToDataUrl(f)); });
      browse.addEventListener("click", () => file.click());
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "cthulhu-ip-btn cthulhu-ip-cancel"; cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => done(null));
      actions.appendChild(paste); actions.appendChild(browse); actions.appendChild(cancel);
      panel.appendChild(actions); panel.appendChild(file);

      overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
      document.body.appendChild(overlay);
    });
  }

  /* --- serialize / persist --- */
  function serialize() {
    return grid.engine.nodes
      .filter((n) => n.el && n.el._cthulhu)
      .map((n) => ({ widget: n.el._cthulhu.id, x: n.x, y: n.y, w: n.w, h: n.h, config: n.el._cthulhu.config }));
  }
  function scheduleSave() {
    if (suppressSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await idbSet(serialize());
      if (bc) { try { bc.postMessage({ mode }); } catch (e) {} } // notify other tabs
    }, 300);
  }

  /* --- widget instance context + lifecycle --- */
  function makeCtx(instance) {
    return {
      get config() { return instance.config; },
      saveConfig(cfg, opts) { instance.config = cfg; scheduleSave(); if (opts && opts.refresh) reRender(instance); },
      refresh() { reRender(instance); },
      sprite: window.CthulhuSprite,
      moon: window.CthulhuWidgets,
      onCleanup(fn) { instance.cleanups.push(fn); },
      assetUrl(path) { return BASE + instance.id + "/assets/" + path; },
      esc: cthEsc,
      pickImage: pickImage, // opens the recent-files/clipboard image picker -> data URL
      openConfig: () => openConfig(instance.el), // let a widget open its own config
      closeConfig: () => { const m = document.querySelector(".cthulhu-config-modal"); if (m) m.remove(); },
      isHome: mode === "home",
      // The home page lives in ONE pinned tab that the Home button toggles to.
      // Navigating it away in place would destroy it (nothing left to toggle
      // back to), so anything that sends the user somewhere else -- search,
      // quick-links, ... -- must come through here rather than setting
      // location.href. On the home tab this asks the browser window directly
      // for a new tab: about:cthulhu is a system-principal page in the parent
      // process, so topChromeWindow is reachable; window.open is the fallback.
      // The browser also enforces this at the source -- FirefoxViewHandler's
      // _homeGuard in browser/base/content/browser.js cancels any in-place
      // load of the Home tab and reopens it in a new tab -- so this is the
      // polite path, not the only line of defence. An ordinary new tab (not
      // the pinned Home) still navigates in place, as a new tab should.
      openLink(url) {
        const chromeWin = window.browsingContext?.topChromeWindow;
        const onHomeTab =
          !!chromeWin?.gBrowser?.selectedTab?.hasAttribute("cthulhu-home-tab");
        if (this.isHome || onHomeTab) {
          if (chromeWin?.gBrowser) {
            chromeWin.gBrowser.addTab(url, {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
              inBackground: false,
              relatedToCurrent: true,
            });
          } else {
            window.open(url, "_blank");
          }
          return;
        }
        location.href = url;
      },
    };
  }
  function runRender(instance) {
    const body = instance.el.querySelector(".cthulhu-widget-body");
    const ctx = makeCtx(instance);
    try { instance.def.render(body, ctx); } catch (e) { console.error("[Cthulhu] render", instance.id, e); }
    if (instance.def.animate) { try { instance.def.animate(body, ctx); } catch (e) { console.error("[Cthulhu] animate", instance.id, e); } }
  }
  function dispose(instance) {
    instance.cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) {} });
  }
  function reRender(instance) {
    dispose(instance);
    instance.el.querySelector(".cthulhu-widget-body").innerHTML = "";
    runRender(instance);
  }

  function mountInto(el, type, config) {
    const def = CthulhuWidgets.get(type);
    if (!def) return console.warn("[Cthulhu] unknown widget:", type);
    // el may be the dragged palette clone GridStack reused — strip its identity.
    el.classList.remove("cthulhu-palette-item");
    el.removeAttribute("data-cthulhu-widget");
    let content = el.querySelector(":scope > .grid-stack-item-content");
    if (!content) { content = document.createElement("div"); el.appendChild(content); }
    // discard leftover palette markup, but NEVER GridStack's resize handles
    [...el.children].forEach((c) => {
      if (c !== content && !c.classList.contains("ui-resizable-handle")) c.remove();
    });
    content.className = "grid-stack-item-content cthulhu-widget";
    content.innerHTML = "";
    const body = document.createElement("div");
    body.className = "cthulhu-widget-body";
    content.appendChild(body);
    content.appendChild(buildTools(el, def));
    const instance = {
      id: type, def, el, cleanups: [],
      config: config || JSON.parse(JSON.stringify(def.defaultConfig || {})),
    };
    el._cthulhu = instance;
    runRender(instance);
    return instance;
  }

  function buildTools(el, def) {
    const tools = document.createElement("div");
    tools.className = "cthulhu-widget-tools";
    if (def.configUI) {
      const c = mkBtn("⚙", "Configure"); // gear
      c.addEventListener("click", (e) => { e.stopPropagation(); openConfig(el); });
      tools.appendChild(c);
    }
    const r = mkBtn("×", "Remove"); // ×
    r.addEventListener("click", (e) => { e.stopPropagation(); removeWidget(el); });
    tools.appendChild(r);
    return tools;
  }
  function mkBtn(txt, label) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cthulhu-widget-btn"; b.textContent = txt;
    b.title = label; b.setAttribute("aria-label", label);
    return b;
  }

  function openConfig(el) {
    const inst = el._cthulhu;
    if (!inst || !inst.def.configUI) return;
    const existing = document.querySelector(".cthulhu-config-modal");
    if (existing) { existing.remove(); return; } // toggle off
    // A centered modal (not an in-widget popover) so it's never cramped/clipped.
    const overlay = document.createElement("div");
    overlay.className = "cthulhu-config-modal";
    const panel = document.createElement("div");
    panel.className = "cthulhu-widget-config"; // reuse the field styling
    const title = document.createElement("h3");
    title.className = "cthulhu-config-title";
    title.textContent = inst.def.name || inst.id;
    panel.appendChild(title);
    overlay.appendChild(panel);
    try { inst.def.configUI(panel, makeCtx(inst)); } catch (e) { console.error("[Cthulhu] configUI", inst.id, e); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function removeWidget(el) {
    if (el._cthulhu) dispose(el._cthulhu);
    grid.removeWidget(el);
    scheduleSave();
  }

  function addWidgetByType(type, pos) {
    const def = CthulhuWidgets.get(type);
    if (!def) return;
    const node = { w: (pos && pos.w) || def.defaultSize.w, h: (pos && pos.h) || def.defaultSize.h };
    if (pos && pos.x != null) node.x = pos.x;
    if (pos && pos.y != null) node.y = pos.y;
    const el = grid.addWidget(node);
    mountInto(el, type, pos && pos.config);
    return el;
  }

  /* --- palette (auto-populated). Items are real .grid-stack-item elements so
   *     GridStack accepts them when dropped onto the grid. --- */
  function buildPalette() {
    const list = document.getElementById("cthulhu-palette-list");
    if (!list) return;
    list.innerHTML = "";
    const cats = CthulhuWidgets.byCategory();
    const order = [...CATEGORY_ORDER, ...Object.keys(cats).filter((c) => !CATEGORY_ORDER.includes(c))];
    for (const cat of order) {
      const defsIn = cats[cat];
      if (!defsIn || !defsIn.length) continue;
      const section = document.createElement("section");
      section.className = "cthulhu-palette-category";
      const h = document.createElement("h2");
      h.textContent = CATEGORY_LABEL[cat] || cat;
      section.appendChild(h);
      for (const def of defsIn) {
        const item = document.createElement("div");
        item.className = "cthulhu-palette-item";
        const dot = document.createElement("span"); dot.className = "cthulhu-palette-dot";
        const name = document.createElement("span"); name.className = "cthulhu-palette-name"; name.textContent = def.name || def.id;
        item.appendChild(dot); item.appendChild(name);
        setupPaletteDrag(item, def);
        section.appendChild(item);
      }
      list.appendChild(section);
    }
  }

  /* Drag a palette item onto the grid. Custom pointer-drag (GridStack's own
   * drag-in doesn't detect drops here): a ghost follows the cursor; releasing
   * over the grid snaps the widget to the cell under the pointer. */
  function setupPaletteDrag(item, def) {
    item.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const ghost = document.createElement("div");
      ghost.className = "cthulhu-drag-ghost";
      ghost.textContent = def.name || def.id;
      document.body.appendChild(ghost);
      const move = (ev) => { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; };
      move(e);
      const up = (ev) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        ghost.remove();
        const gr = grid.el.getBoundingClientRect();
        if (ev.clientX >= gr.left && ev.clientX <= gr.right && ev.clientY >= gr.top && ev.clientY <= gr.bottom) {
          const cell = parseFloat(grid.el.style.getPropertyValue("--cthulhu-cell")) || 156;
          const x = Math.max(0, Math.floor((ev.clientX - gr.left) / cell));
          const y = Math.max(0, Math.floor((ev.clientY - gr.top) / cell));
          addWidgetByType(def.id, { x, y });
          scheduleSave();
        }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  /* --- restore / reset / reload --- */
  function restore(layout) {
    suppressSave = true;
    grid.engine.nodes.slice().forEach((n) => n.el && n.el._cthulhu && dispose(n.el._cthulhu));
    grid.removeAll(true); // true = also remove the DOM (v13's default preserves it)
    grid.el.querySelectorAll(":scope > .grid-stack-item").forEach((el) => el.remove()); // purge strays
    grid.batchUpdate();
    for (const item of layout) addWidgetByType(item.widget, item);
    grid.batchUpdate(false);
    setTimeout(() => { suppressSave = false; }, 0); // let post-restore relayout settle
  }
  async function loadOrDefault() {
    const saved = await idbGet();
    if (Array.isArray(saved) && saved.length) { restore(saved); }
    else { restore(DEFAULT_LAYOUT); await idbSet(serialize()); }
  }
  async function reset() {
    await idbClear();
    restore(DEFAULT_LAYOUT);
    await idbSet(serialize());
    if (bc) { try { bc.postMessage({ mode }); } catch (e) {} }
  }
  async function reloadLayout() {
    const saved = await idbGet();
    restore(Array.isArray(saved) && saved.length ? saved : DEFAULT_LAYOUT);
  }

  /* --- widget discovery --- */
  async function loadWidgetScripts() {
    let ids = [];
    try { ids = await (await fetch(BASE + "index.json")).json(); }
    catch (e) { console.error("[Cthulhu] widgets/index.json", e); }
    for (const id of ids) {
      await new Promise((res) => {
        const s = document.createElement("script");
        s.src = BASE + id + "/" + id + ".js";
        s.onload = () => res();
        s.onerror = () => { console.error("[Cthulhu] widget script failed:", id); res(); };
        document.head.appendChild(s);
      });
    }
  }

  function wireChrome() {
    // The settings button (bottom-right) toggles the palette drawer, and the
    // grid shrinks to its left so widgets never hide behind it.
    const drawer = document.getElementById("cthulhu-drawer");
    const toggle = document.getElementById("cthulhu-settings");
    if (drawer && toggle) {
      toggle.addEventListener("click", () => {
        const open = drawer.classList.toggle("open");
        document.body.classList.toggle("cthulhu-drawer-open", open);
        if (window.__cthulhuRelayout) window.__cthulhuRelayout();
      });
    }
    const resetBtn = document.getElementById("cthulhu-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => reset());
  }

  function setupSync() {
    try { bc = new BroadcastChannel("cthulhu-home"); } catch (e) { return; }
    bc.onmessage = (ev) => {
      if (!ev.data || ev.data.mode !== mode) return; // only same-mode tabs share
      if (document.hidden) reloadLayout(); else pendingReload = true;
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && pendingReload) { pendingReload = false; reloadLayout(); }
    });
  }

  /* GridStack starts a real (placeholder-swapping) drag on the very first
   * pointer movement -- even a 1-2px click jitter -- which swallows the
   * native click/mouseup on whatever was under the cursor (confirmed live:
   * the event's final target becomes GridStack's drag placeholder, not the
   * original element). So a widget with clickable content (e.g. quick-links'
   * link tile) can never rely on a plain `click` listener once it's grabbable.
   * Work around it generically here: track each drag's start cell, and if a
   * drag ends in the SAME cell it started in (no actual reposition), treat it
   * as a click and notify the widget via its optional onClick(ctx) hook. */
  function setupClickThroughDrag() {
    let start = null;
    grid.on("dragstart", (event, el) => {
      const n = el.gridstackNode;
      start = n ? { el, x: n.x, y: n.y } : null;
    });
    grid.on("dragstop", (event, el) => {
      const n = el.gridstackNode;
      const inst = el._cthulhu;
      if (start && start.el === el && n && n.x === start.x && n.y === start.y &&
          inst && inst.def.onClick) {
        try { inst.def.onClick(makeCtx(inst), event); } catch (e) { console.error("[Cthulhu] onClick", inst.id, e); }
      }
      start = null;
    });
  }

  async function init(g) {
    grid = g;
    mode = location.hash === "#home" ? "home" : "newtab";
    ["change", "added", "removed"].forEach((ev) => grid.on(ev, () => scheduleSave()));
    setupClickThroughDrag();
    await loadWidgetScripts();
    buildPalette();
    wireChrome();
    setupSync();
    await loadOrDefault();
    console.log("[Cthulhu:home] mode:", mode, "| widgets:", CthulhuWidgets.all().map((d) => d.id).join(", "));
  }

  return { init, addWidgetByType, removeWidget, serialize, reset, getMode: () => mode };
})();
