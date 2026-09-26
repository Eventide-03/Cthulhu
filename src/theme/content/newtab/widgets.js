/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Cthulhu home widget system.
 *
 *   window.CthulhuWidgets — registry each widget self-registers into (+ shared
 *     moon-phase and site-icon helpers). See widgets/README.md.
 *   window.CthulhuHome — the page app: auto-builds the palette, drag/drop from
 *     palette onto the GridStack grid, remove, per-widget config, and persistence.
 *
 * Two modes, chosen from the URL hash:
 *   about:cthulhu       -> "newtab" layout, SHARED across all new tabs (synced).
 *   about:cthulhu#home  -> "home"   layout, its own separate grid.
 * Both persist to IndexedDB (localStorage is unavailable on this principal).
 * ============================================================================= */
"use strict";

/* ------------------------- shared key/value store ---------------------------
 * IndexedDB, because localStorage is unavailable on this page's principal. One
 * database for every caller -- the saved layouts, the image picker's recents,
 * and the site-icon cache below. Nothing here rejects: a home page that cannot
 * reach its storage should come up empty, not throw.
 *
 * NOTE: top-level names in this file share ONE lexical scope with every widget
 * script (see loadWidgetScripts), so they carry the _cth prefix. */
const _cthKV = (function () {
  const DB = "cthulhu-home", STORE = "kv";
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
  return {
    get: (k) => withStore("readonly", (s) => s.get(k)),
    set: (k, v) => withStore("readwrite", (s) => { s.put(v, k); return null; }),
    del: (k) => withStore("readwrite", (s) => { s.delete(k); return null; }),
  };
})();

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
  const MOON_URL = "chrome://cthulhu/content/newtab/assets/moon.png";
  const MOON_FRAMES = 8;
  /* Per-frame opaque bounds of the moon strip, measured once from the alpha
   * channel. A crescent's art fills only one side of its frame (the dark of
   * the moon is transparent), so the frame's centre and the art's centre are
   * up to ~8px apart at 1x. moonEl() uses this to put the ART in the middle.
   * Resolves to null if the strip cannot be read; callers then leave the
   * frame where it is. */
  let moonBoundsP = null;
  function moonBounds() {
    if (moonBoundsP) return moonBoundsP;
    moonBoundsP = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const fw = Math.floor(img.width / MOON_FRAMES), fh = img.height;
          const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
          const c2 = cv.getContext("2d", { willReadFrequently: true }); c2.drawImage(img, 0, 0);
          const d = c2.getImageData(0, 0, img.width, img.height).data;
          const out = { frameW: fw, frameH: fh };
          for (let f = 0; f < MOON_FRAMES; f++) {
            let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
            for (let y = 0; y < fh; y++) {
              for (let x = 0; x < fw; x++) {
                if (d[(y * img.width + f * fw + x) * 4 + 3] > 8) {
                  if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
              }
            }
            if (x1 >= 0) out[f] = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
          }
          resolve(out);
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = MOON_URL;
    });
    return moonBoundsP;
  }
  /* -------------------------------- site icons ------------------------------
   * One resolver for every tile that shows a site's logo -- quick links and
   * folder entries, which each used to carry their own copy of it.
   *
   * WHY IT IS MORE THAN A /favicon.ico FETCH. That file is 32x32 on a good day
   * and 16x16 on an ordinary one (youtube.com serves 16; reddit.com 32). A
   * quick-link tile draws its logo at 48 CSS px, which is 96 device pixels on
   * a 2x display -- so the everyday case was a 16px image blown up six times,
   * and the tiles looked it. The fix is to ASK FOR A BIGGER ONE, from places
   * the site itself publishes:
   *
   *   /apple-touch-icon.png, /apple-touch-icon-precomposed.png
   *       120-180px by convention, and free to guess: no page fetch needed.
   *   /favicon.ico
   *       the old source. Still worth asking -- netflix.com's is 64px.
   *   the <link rel="icon"|"apple-touch-icon"> tags in the site's own <head>
   *       the general answer, and the only one for a site that serves nothing
   *       at a guessable path: youtube.com 404s on both apple paths and
   *       declares a 144 here; discord.com and music.youtube.com likewise.
   *       This one costs a page fetch, so it is reached only when the guesses
   *       came up short -- and the body is cut off after 64 KB.
   *
   * The first hit does not win, the BIGGEST does. Sizes are measured off the
   * decoded image, never trusted from the markup: reddit.com serves 57x57 at
   * /apple-touch-icon.png and 128x128 at the -precomposed one right beside it,
   * and taking the first would have left the tile nearly as coarse as before.
   *
   * Results are cached in _cthKV, i.e. on disk, for a month. The ladder is
   * several requests where a site hides its good icon, and that must be a cost
   * paid once per host -- not once per host per new tab.
   *
   * PRIVACY -- same doctrine as before, and PRIVACY.md spells it out. The
   * linked site is asked first and is the only party contacted by default: it
   * is the one party that already knows you are interested in it. The
   * DuckDuckGo fallback, and any icon a site declares on a CDN it does not
   * own, are both gated on cthulhu.favicons.remote, so setting that false
   * still means nothing but the linked host is ever reached. Only the domain
   * is ever sent, and credentials are omitted so no cookie rides along. */
  const ICON_WANT_PX = 96;        // a 48px tile on a 2x display; stop climbing here
  const ICON_CAP_PX = 256;        // cache no larger; past this it is all bloat
  const ICON_TIMEOUT_MS = 3000;   // per request, so one dead host cannot stall a tile
  const ICON_HTML_MAX = 65536;    // of a homepage -- far past any <head>
  const ICON_BYTES_MAX = 2 * 1024 * 1024;
  const ICON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const ICON_TTL_MISS_MS = 24 * 60 * 60 * 1000; // a host with no icon, retried sooner
  const ICON_BUDGET_MS = 8000;    // for a whole ladder, however many rungs are left
  const iconPending = new Map(); // host -> Promise, so four tiles on one host resolve once
  const iconWatch = new Map();   // host -> Set<fn>, live only while that ladder runs

  /* Hand each improvement to the tiles waiting on it, rather than making them
   * wait for the last rung. A host that hides its good icon takes several
   * requests to get to, and a tile that sits blank through all of them looks
   * broken -- so the 32px one goes up straight away and is replaced in place
   * when something better arrives. */
  function iconBetter(host, dataUrl) {
    const set = iconWatch.get(host);
    if (!set) return;
    for (const fn of set) { try { fn(dataUrl); } catch (e) {} }
  }

  function iconRemoteOk() {
    try {
      if (typeof Services !== "undefined" && Services.prefs) {
        return Services.prefs.getBoolPref("cthulhu.favicons.remote", true);
      }
    } catch (e) {}
    return true;
  }

  function iconFetch(url, init) {
    // credentials:"omit" -- every one of these is cross-origin from this page,
    // so no cookie would be attached anyway; saying it outright keeps it true
    // of the homepage fetch, which is the one request a site could tie to an
    // account if it ever did carry one.
    return fetch(url, Object.assign({
      credentials: "omit",
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    }, init));
  }

  /* Natural size of a decoded icon, or 0 if it does not decode at all. SVG
   * renders at any size, so it outranks every raster instead of reporting
   * whatever its viewBox happens to say. */
  function iconSize(dataUrl, type) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(/^image\/svg\+xml/i.test(type)
        ? ICON_CAP_PX
        : Math.max(img.naturalWidth, img.naturalHeight) || 0);
      img.onerror = () => resolve(0);
      img.src = dataUrl;
    });
  }

  /* x.com's apple-touch-icon is 1024x1024, for a tile that draws 96 device
   * pixels. Redraw it small before it goes anywhere near the cache. SVG is
   * left alone -- rasterising it would throw away the one thing it is good
   * for. */
  function iconShrink(dataUrl, type, px) {
    if (px <= ICON_CAP_PX || /^image\/svg\+xml/i.test(type)) return Promise.resolve(dataUrl);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = ICON_CAP_PX / Math.max(img.naturalWidth, img.naturalHeight);
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.naturalWidth * k));
          cv.height = Math.max(1, Math.round(img.naturalHeight * k));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/png"));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /* Fetch one candidate and measure it -> { url: dataURL, px } or null.
   * Inlined as a data URL because a remote <img src> is blocked on this
   * privileged page, while a system-principal fetch is not. */
  async function iconTry(url) {
    let blob;
    try {
      const r = await iconFetch(url);
      if (!r.ok) return null;
      blob = await r.blob();
    } catch (e) { return null; }
    // A site that answers a missing icon path with an HTML error page AND a
    // 200 status would otherwise be inlined as a "broken image" data URL.
    // netflix.com does exactly this for both apple-touch-icon paths.
    if (/^text\/html/i.test(blob.type)) return null;
    if (blob.size < 80 || blob.size > ICON_BYTES_MAX) return null; // empty/1x1, or not an icon
    const dataUrl = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    const px = await iconSize(dataUrl, blob.type);
    if (!px) return null;
    return { url: await iconShrink(dataUrl, blob.type, px), px };
  }

  /* The icons a site declares in its own <head>, biggest first.
   *
   * Read as a stream and cut off at </head> or 64 KB, whichever comes first,
   * so a heavy homepage costs a header's worth of traffic rather than a
   * megabyte; the Range header asks for only that much from servers that
   * honour it. Parsed with a regex over <link> tags rather than DOMParser --
   * the tags are trivial, and half a document need never become a document on
   * this privileged page. */
  async function iconDeclared(host) {
    let text = "";
    try {
      const r = await iconFetch("https://" + host + "/", {
        headers: { Range: "bytes=0-" + (ICON_HTML_MAX - 1) },
      });
      if (!r.ok || !r.body) return [];
      const reader = r.body.getReader();
      const dec = new TextDecoder("utf-8", { fatal: false });
      for (let n = 0; n < ICON_HTML_MAX; ) {
        const chunk = await reader.read();
        if (chunk.done) break;
        n += chunk.value.length;
        text += dec.decode(chunk.value, { stream: true });
        if (/<\/head/i.test(text)) break;
      }
      try { reader.cancel(); } catch (e) {}
    } catch (e) { return []; }

    const seen = new Set(), out = [];
    for (const tag of text.match(/<link\b[^>]*>/gi) || []) {
      const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]*)/i) || [])[1] || "";
      // "icon", "shortcut icon", "apple-touch-icon[-precomposed]". Deliberately
      // NOT rel="mask-icon", which is a one-colour silhouette, not the logo.
      if (!/(^|\s)icon(\s|$)/i.test(rel) &&
          !/(^|\s)apple-touch-icon(-precomposed)?(\s|$)/i.test(rel)) continue;
      const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!href) continue;
      let abs;
      try { abs = new URL(href, "https://" + host + "/").href; } catch (e) { continue; }
      if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
      seen.add(abs);
      // sizes="144x144", or "any" for an SVG; an apple-touch-icon without one
      // is 180 by convention. Only an ordering hint -- whatever is fetched
      // still gets measured.
      const nums = (((tag.match(/\bsizes\s*=\s*["']?([^"'>]*)/i) || [])[1] || "").match(/\d+/g) || []).map(Number);
      out.push({
        url: abs,
        hint: nums.length ? Math.max.apply(null, nums)
          : (/apple-touch-icon/i.test(rel) ? 180 : 0),
      });
    }
    out.sort((a, b) => b.hint - a.hint);
    return out.slice(0, 4); // a long <head> must not become a long fetch queue
  }

  async function iconResolve(host, origin) {
    const remote = iconRemoteOk();
    const deadline = Date.now() + ICON_BUDGET_MS;
    let best = null;
    const take = async (url) => {
      // An icon a site declares on a CDN it does not own is a third party, and
      // cthulhu.favicons.remote=false means "the linked host, and nobody else".
      if (!remote) {
        try { if (new URL(url).hostname !== host) return false; } catch (e) { return false; }
      }
      const got = await iconTry(url);
      if (got && (!best || got.px > best.px)) { best = got; iconBetter(host, best.url); }
      // Stop once it is good enough -- or once the ladder has taken long
      // enough. Every rung at the 3s cap would be half a minute of blank
      // tile, and whatever is already in hand beats a perfect icon nobody
      // stayed to see.
      return (!!best && best.px >= ICON_WANT_PX) || Date.now() > deadline;
    };
    // Guessable paths first: no page fetch, and this is where the big ones are.
    if (await take(origin + "/apple-touch-icon.png")) return best;
    if (await take(origin + "/apple-touch-icon-precomposed.png")) return best;
    if (await take(origin + "/favicon.ico")) return best;
    for (const c of await iconDeclared(host)) if (await take(c.url)) return best;
    if (remote) await take("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico");
    return best;
  }

  async function iconFor(host) {
    let u;
    try { u = new URL("https://" + host + "/"); } catch (e) { return null; }
    if (u.hostname !== host) return null; // a bare hostname, not a URL fragment
    const k = "favicon:" + host;
    const hit = await _cthKV.get(k);
    if (hit && hit.v === 1 && Date.now() - hit.t < (hit.url ? ICON_TTL_MS : ICON_TTL_MISS_MS)) {
      return hit.url || null;
    }
    const best = await iconResolve(host, u.origin);
    try {
      await _cthKV.set(k, { v: 1, t: Date.now(), url: best ? best.url : null, px: best ? best.px : 0 });
    } catch (e) {}
    return best ? best.url : null;
  }

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
    /** A pixel moon element for `date`, sized to `size` px (uses the 8-frame strip).
     *
     *  The VISIBLE pixels are centred, not the frame. A crescent's art only
     *  fills one side of its 32x32 frame, so centring the frame put the lit
     *  sliver well off to one side of the tile. Two elements: the outer box
     *  clips; the inner one carries exactly its own frame and is what gets
     *  nudged. (Shifting the background alone would drag the NEIGHBOURING
     *  frame into view -- the full moon's edge next to a crescent.) */
    moonEl(date, size) {
      size = size || 32;
      const p = this.moonPhase(date);
      const el = document.createElement("div");
      el.className = "cthulhu-moon";
      el.style.cssText = "position:relative; overflow:hidden; width:" + size + "px; height:" + size + "px;";
      const frame = document.createElement("div");
      frame.className = "cthulhu-moon-frame";
      frame.style.cssText = "position:absolute; left:0; top:0; width:" + size + "px; height:" + size + "px; image-rendering:pixelated;";
      frame.style.backgroundImage = 'url("' + MOON_URL + '")';
      frame.style.backgroundSize = MOON_FRAMES * size + "px " + size + "px";
      frame.style.backgroundPositionX = -(p.frame * size) + "px";
      frame.dataset.frame = String(p.frame);
      el.appendChild(frame);
      el.title = p.name;
      moonBounds().then((b) => {
        const fb = b && b[p.frame];
        if (!fb) return;
        const s = size / b.frameW;
        // Whole device pixels, so the nudge never blurs the art.
        const dpr = window.devicePixelRatio || 1;
        const snap = (v) => Math.round(v * dpr) / dpr;
        frame.style.left = snap(((b.frameW - 1) / 2 - fb.cx) * s) + "px";
        frame.style.top = snap(((b.frameH - 1) / 2 - fb.cy) * s) + "px";
      });
      return el;
    },
    moonBounds,
    /** A site's logo as a data URL, at the best resolution it publishes, or
     *  null. `onBetter` (optional) is called with each improvement while the
     *  search is still running, so a tile can show the first icon found and
     *  swap in a sharper one when it turns up; the promise settles on the last.
     *  See the site-icons block above; also reachable as ctx.favicon. */
    favicon(host, onBetter) {
      const h = String(host || "").toLowerCase();
      let p = iconPending.get(h);
      if (!p) {
        iconWatch.set(h, new Set()); // before the ladder starts, so nothing is missed
        p = iconFor(h).catch(() => null).then((r) => { iconWatch.delete(h); return r; });
        iconPending.set(h, p);
      }
      if (typeof onBetter === "function") {
        const set = iconWatch.get(h); // gone once this host's ladder has finished
        if (set) set.add(onBetter);
      }
      return p;
    },
  };
})();

function cthEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------ shared UI kit ------------------------------
 * Small controls for config panels, exposed as ctx.ui so every widget builds
 * the same rows the same way. All createElement: on this system-principal page
 * innerHTML sanitizes <input>/<button>/<select> out (see widgets/README.md). */
const cthUi = {
  /** A labelled row; `control` goes to the right of the text. */
  row(text, control) {
    const label = document.createElement("label");
    label.className = "cw-ui-row";
    const span = document.createElement("span"); span.className = "cw-ui-label"; span.textContent = text;
    label.appendChild(span); label.appendChild(control);
    return label;
  },
  /** A stacked group with a small caption above. */
  field(text) {
    const f = document.createElement("div"); f.className = "cw-ui-field";
    const cap = document.createElement("div"); cap.className = "cw-ui-cap"; cap.textContent = text;
    f.appendChild(cap);
    return f;
  },
  checkRow(text, checked, onChange) {
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    const label = document.createElement("label"); label.className = "cw-ui-row cw-ui-check";
    label.appendChild(cb); label.appendChild(document.createTextNode(" " + text));
    return label;
  },
  textRow(text, value, onChange, opts) {
    const inp = document.createElement("input"); inp.type = (opts && opts.type) || "text"; inp.value = value == null ? "" : value;
    if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
    inp.addEventListener("change", () => onChange(inp.value));
    return cthUi.row(text, inp);
  },
  /* A one-of-many chooser, built from BUTTONS rather than a native <select>.
   *
   * WHY NOT <select>: about:cthulhu holds the system principal in the parent
   * process, and a select's menu is a chrome-level popup the page only reaches
   * through the ContentSelectDropdown actor pair. The popup opens and
   * highlights, but the choice never comes back to the page as a `change`
   * event -- so picking anything silently did nothing. Setting .value from
   * script worked fine, which is what made it so confusing to track down.
   * Buttons are a plain DOM click with no actor round trip.
   *
   * Short lists sit inline next to the label as chips; long ones (many
   * entries, or long labels) stack under a caption instead, because chips with
   * calendar-length names wrap into an unreadable mess. Pass {stack:true} to
   * force stacking -- worth doing when the options are filled in later and you
   * don't want the layout to jump when they arrive.
   *
   * onChange receives a STRING, matching what a <select> used to hand back, so
   * existing callers that do `+v` keep working.
   *
   * Returns the row, with .setOptions(options, value) for lists that load late.
   */
  selectRow(text, options, value, onChange, opts) {
    const group = document.createElement("div");
    group.className = "cw-ui-choice";
    const forceStack = !!(opts && opts.stack);
    let buttons = [];

    const paint = (val) => {
      for (const b of buttons) b.classList.toggle("on", String(b.dataset.value) === String(val));
    };
    const build = (list, val) => {
      group.textContent = "";
      buttons = [];
      const stack = forceStack || list.length > 4 ||
        list.some((o) => String(o.label).length > 18);
      group.classList.toggle("stack", stack);
      for (const o of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cw-ui-choice-btn";
        b.dataset.value = String(o.value);
        b.textContent = o.label;
        b.title = o.title || o.label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          paint(o.value);
          onChange(String(o.value));
        });
        buttons.push(b);
        group.appendChild(b);
      }
      paint(val);
    };
    build(options, value);

    // Stacked lists read better under a caption than squeezed beside a label.
    const stacked = group.classList.contains("stack");
    const row = stacked ? cthUi.field(text) : cthUi.row(text, group);
    if (stacked) row.appendChild(group);
    row.setOptions = (list, val) => build(list, val === undefined ? value : val);
    row.setValue = (val) => paint(val);
    return row;
  },
  /* A compact one-of-many chooser for places too narrow for a row of chips --
   * a widget's own toolbar, say. Shows the current label; clicking opens a list
   * in a body-appended popover, so a small tile cannot clip it. Same reason as
   * selectRow for not using a native <select>: the popup's choice never gets
   * back to this page. */
  pickerButton(options, value, onChange, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cw-ui-picker" + ((opts && opts.className) ? " " + opts.className : "");
    let list = options.slice();
    let current = value;
    const labelFor = (v) => {
      const f = list.find((o) => String(o.value) === String(v));
      return f ? f.label : (opts && opts.empty) || "—";
    };
    const paintBtn = () => {
      btn.textContent = labelFor(current);
      btn.title = btn.textContent;
    };
    paintBtn();

    let pop = null;
    const close = () => {
      if (!pop) return;
      pop.remove(); pop = null;
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("blur", close);
    };
    const onOutside = (e) => { if (pop && !pop.contains(e.target) && e.target !== btn) close(); };
    const open = () => {
      if (pop) { close(); return; }
      pop = document.createElement("div");
      pop.className = "cw-ui-picker-pop";
      const group = document.createElement("div");
      group.className = "cw-ui-choice stack";
      for (const o of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cw-ui-choice-btn" + (String(o.value) === String(current) ? " on" : "");
        b.textContent = o.label;
        b.title = o.label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          current = o.value;
          paintBtn();
          close();
          onChange(String(o.value));
        });
        group.appendChild(b);
      }
      pop.appendChild(group);
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      const pr = pop.getBoundingClientRect();
      let left = r.left;
      let top = r.bottom + 4;
      if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
      if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 4);
      pop.style.left = Math.max(8, left) + "px";
      pop.style.top = top + "px";
      document.addEventListener("pointerdown", onOutside, true);
      window.addEventListener("blur", close);
    };
    // The tile is drag-enabled; don't let the press start a widget drag.
    btn.setAttribute("data-cthulhu-nodrag", "");
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    btn.setOptions = (next, val) => {
      list = next.slice();
      if (val !== undefined) current = val;
      paintBtn();
      if (pop) { close(); open(); }
    };
    btn.setValue = (v) => { current = v; paintBtn(); };
    btn.close = close;
    return btn;
  },
  rangeRow(text, o, onChange) {
    const wrap = document.createElement("span"); wrap.className = "cw-ui-range";
    const inp = document.createElement("input"); inp.type = "range"; inp.min = o.min; inp.max = o.max; inp.step = o.step || 1; inp.value = o.value;
    const out = document.createElement("span"); out.className = "cw-ui-out"; out.textContent = o.value + (o.unit || "");
    inp.addEventListener("input", () => { out.textContent = inp.value + (o.unit || ""); });
    inp.addEventListener("change", () => onChange(+inp.value));
    wrap.appendChild(inp); wrap.appendChild(out);
    return cthUi.row(text, wrap);
  },
  /** Colour: native picker + hex text, kept in sync. onChange gets a valid hex. */
  colorRow(text, value, onChange) {
    const isHex = (v) => window.CthulhuThemes ? CthulhuThemes.color.isHex(v) : /^#[0-9a-f]{6}$/i.test(v);
    let cur = isHex(value) ? value : "#ffffff";
    const wrap = document.createElement("span"); wrap.className = "cw-ui-color";
    const pick = document.createElement("input"); pick.type = "color"; pick.value = cur;
    const hex = document.createElement("input"); hex.type = "text"; hex.className = "cw-ui-hex"; hex.value = cur; hex.spellcheck = false; hex.maxLength = 7;
    const emit = (v) => { cur = v; pick.value = v; hex.value = v; onChange(v); };
    pick.addEventListener("input", () => emit(pick.value));
    hex.addEventListener("change", () => { let v = hex.value.trim(); if (v[0] !== "#") v = "#" + v; if (isHex(v)) emit(v.toLowerCase()); else hex.value = cur; });
    wrap.appendChild(pick); wrap.appendChild(hex);
    return cthUi.row(text, wrap);
  },
  /** Clickable preset chips. items: [{id, name, colors:[hex,...]}]. */
  swatches(items, selectedId, onPick) {
    const wrap = document.createElement("div"); wrap.className = "cw-ui-swatches";
    for (const it of items) {
      const b = document.createElement("button"); b.type = "button"; b.className = "cw-ui-swatch"; b.title = it.name || it.id;
      if (it.id === selectedId) b.classList.add("on");
      const cols = it.colors || [];
      b.style.background = cols.length > 1 ? "linear-gradient(135deg, " + cols.join(", ") + ")" : (cols[0] || "transparent");
      b.addEventListener("click", () => { for (const x of wrap.children) x.classList.toggle("on", x === b); onPick(it); });
      wrap.appendChild(b);
    }
    return wrap;
  },
  button(text, onClick, opts) {
    const b = document.createElement("button"); b.type = "button";
    b.className = opts && opts.primary ? "cw-cfg-save" : "cw-ui-btn";
    b.textContent = text; b.addEventListener("click", onClick);
    return b;
  },
  /** Transient message, bottom-centre. */
  toast(text) {
    let t = document.getElementById("cthulhu-toast");
    if (!t) { t = document.createElement("div"); t.id = "cthulhu-toast"; document.body.appendChild(t); }
    t.textContent = text; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 1600);
  },
};

/* ----------------------------------- app ----------------------------------- */
window.CthulhuHome = (function () {
  const BASE = "chrome://cthulhu/content/newtab/widgets/";
  const CATEGORY_ORDER = ["utility", "aesthetic", "play"];
  const CATEGORY_LABEL = { utility: "Utility", aesthetic: "Aesthetic", play: "Play" };
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

  /* --- persistence (per-mode key, in the shared _cthKV store) --- */
  const key = () => "layout:" + mode;
  const idbGet = () => _cthKV.get(key());
  const idbSet = (v) => _cthKV.set(key(), v);
  const idbClear = () => _cthKV.del(key());

  /* --- image picker (Opera-GX-style: recent files + clipboard paste) --- */
  const REC_KEY = "recentImages";
  async function getRecents() {
    const r = await _cthKV.get(REC_KEY);
    return Array.isArray(r) ? r : [];
  }
  async function addRecent(dataUrl) {
    const list = await getRecents();
    const next = [dataUrl, ...list.filter((u) => u !== dataUrl)].slice(0, 8);
    await _cthKV.set(REC_KEY, next);
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
      favicon: (host) => window.CthulhuWidgets.favicon(host),
      onCleanup(fn) { instance.cleanups.push(fn); },
      assetUrl(path) { return BASE + instance.id + "/assets/" + path; },
      esc: cthEsc,
      theme: window.CthulhuThemes, // browser-wide theme engine (content/themes.js)
      ui: cthUi,                   // shared config-panel controls (see widgets/README.md)
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
    // The hover tools go on the ITEM (el), outside the content's overflow:
    // hidden, so they can straddle the top border and never cover a widget's
    // own top-right controls (the calendar's Mine / refresh / + used to sit
    // exactly under them). See .cthulhu-widget-tools in newtab.css.
    el.appendChild(buildTools(el, def));
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
        item.appendChild(paletteIcon(def));
        const name = document.createElement("span"); name.className = "cthulhu-palette-name"; name.textContent = def.name || def.id;
        item.appendChild(name);
        setupPaletteDrag(item, def);
        section.appendChild(item);
      }
      list.appendChild(section);
    }
  }

  /* ART SLOT: every widget's palette icon is widgets/<id>/assets/icon.png
   * (16x16, drawn 1:1, pixelated) -- or whatever `icon` names in its
   * definition. A missing file falls back to the accent dot, so a new widget
   * works before it has art. */
  function paletteIcon(def) {
    const img = document.createElement("img");
    img.className = "cthulhu-palette-icon";
    img.alt = "";
    img.draggable = false;
    img.src = BASE + def.id + "/assets/" + (def.icon || "icon.png");
    img.addEventListener("error", () => {
      const dot = document.createElement("span"); dot.className = "cthulhu-palette-dot";
      img.replaceWith(dot);
    }, { once: true });
    return img;
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
      ghost.appendChild(paletteIcon(def));
      ghost.appendChild(document.createTextNode(def.name || def.id));
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
