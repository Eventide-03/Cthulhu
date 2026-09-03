/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Cthulhu theme engine — the ONE place a palette is chosen and applied.
 *
 * Loaded into every browser window (browser.js -> loadSubScript) AND into the
 * about:cthulhu page (index.html <script>), so both apply the same palette from
 * the same source of truth:
 *
 *   pref `cthulhu.theme`  = "ambient"  -> follows the time of day (dawn/day/dusk/night)
 *                         | "<preset>" -> a fixed palette from PRESETS below
 *
 * Applying a theme means injecting ONE <style> rule on :root that re-assigns the
 * A2 tokens theme.css defines (--bg, --accent, ...). Nothing else changes: every
 * piece of chrome and every widget already reads var(--...), so it follows.
 * The document also gets attributes for CSS to hook if it wants:
 *   :root[cthulhu-theme="<id>"]  and, in ambient mode, :root[cthulhu-ambient-time="<band>"]
 * and a "cthulhu-theme-change" event is dispatched on the document.
 *
 * A palette is either spelled out in full (the hand-tuned ones) or given as a
 * SEED of bg / fg / accent / fg-on-accent, with the rest derived by mixing --
 * elevated surfaces lean toward the foreground, muted text toward the
 * background -- which works for light and dark palettes alike. Add a preset by
 * adding an entry to PRESETS; it shows up in the Theme widget on its own.
 *
 * Colour helpers (hex <-> rgb <-> hsl, mix, contrast) live on .color for the
 * widgets that need them (theme, gradient, orb, palette).
 * ============================================================================= */
"use strict";

window.CthulhuThemes = (function () {
  const PREF = "cthulhu.theme";
  const FAV_PREF = "cthulhu.theme.favorites";
  const STYLE_ID = "cthulhu-theme-tokens";
  const AMBIENT = "ambient";
  const TICK_MS = 5 * 60 * 1000;
  const DEFAULT_LOC = { lat: 40.7128, lng: -74.006 }; // placeholder; set cthulhu.ambient.latitude/longitude
  const RAD = Math.PI / 180;

  /* ------------------------------ colour math ----------------------------- */
  const color = {
    hexToRgb(hex) {
      let h = String(hex || "").trim().replace(/^#/, "");
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      if (!/^[0-9a-f]{6}$/i.test(h)) return null;
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgbToHex(r, g, b) {
      const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
      return "#" + c(r) + c(g) + c(b);
    },
    isHex(v) { return !!color.hexToRgb(v); },
    /** Mix `a` toward `b` by t (0..1). Both hex; returns hex. */
    mix(a, b, t) {
      const A = color.hexToRgb(a), B = color.hexToRgb(b);
      if (!A || !B) return a;
      return color.rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    },
    /** hex -> [h 0..360, s 0..1, l 0..1] */
    hexToHsl(hex) {
      const rgb = color.hexToRgb(hex);
      if (!rgb) return null;
      const [r, g, b] = rgb.map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
      if (max === min) return [0, 0, l];
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [h * 60, s, l];
    },
    hslToHex(h, s, l) {
      h = ((h % 360) + 360) % 360;
      const f = (n) => {
        const k = (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      return color.rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
    },
    /** rgba() string from hex + alpha, for the translucent line tokens. */
    alpha(hex, a) {
      const c = color.hexToRgb(hex) || [255, 255, 255];
      return "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + a + ")";
    },
    luminance(hex) {
      const c = color.hexToRgb(hex) || [0, 0, 0];
      const lin = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    },
    /** Black or white, whichever reads better on `hex`. */
    onColor(hex) { return color.luminance(hex) > 0.4 ? "#0a0a0a" : "#ffffff"; },
  };

  /* --------------------------------- presets ------------------------------ */
  const TOKENS = ["bg", "bg-elevated", "surface", "surface-hover", "fg", "fg-muted",
    "accent", "accent-hover", "fg-on-accent", "grid-line", "border"];

  /** Fill a full token set from a seed. */
  function derive(seed) {
    const { bg, fg, accent } = seed;
    const light = color.luminance(bg) > 0.4;
    return {
      "bg": bg,
      "bg-elevated": color.mix(bg, fg, light ? 0.02 : 0.05),
      "surface": color.mix(bg, fg, light ? 0.035 : 0.025),
      "surface-hover": color.mix(bg, fg, light ? 0.07 : 0.09),
      "fg": fg,
      "fg-muted": color.mix(fg, bg, 0.45),
      "accent": accent,
      "accent-hover": color.mix(accent, light ? "#000000" : "#ffffff", 0.12),
      "fg-on-accent": seed["fg-on-accent"] || color.onColor(accent),
      "grid-line": color.alpha(fg, light ? 0.07 : 0.1),
      "border": color.alpha(fg, light ? 0.12 : 0.14),
    };
  }

  // Hand-tuned palettes keep their exact values (they came from theme.css and
  // ambient-theme.css); the rest are seeds. `mood` is just a one-liner for the
  // Theme widget. `light: true` marks a light palette so consumers can tell.
  const PRESETS = [
    { id: "night", name: "Night", mood: "blue-black, moonlit", tokens: {
      "bg": "#14151c", "bg-elevated": "#1d1f2a", "surface": "#191b24", "surface-hover": "#262a38",
      "fg": "#e6e8f0", "fg-muted": "#8b90a6", "accent": "#6c8cff", "accent-hover": "#90a8ff",
      "fg-on-accent": "#0a0a12", "grid-line": "rgba(150, 170, 255, 0.06)", "border": "rgba(150, 170, 255, 0.14)" } },
    { id: "cthulhu", name: "Cthulhu", mood: "the default: near-black, sea-green", tokens: {
      "bg": "#1a1a1a", "bg-elevated": "#242424", "surface": "#1f1f1f", "surface-hover": "#2e2e2e",
      "fg": "#e8e8e8", "fg-muted": "#9a9a9a", "accent": "#5ad1b0", "accent-hover": "#6fe0c2",
      "fg-on-accent": "#0a0a0a", "grid-line": "rgba(255, 255, 255, 0.22)", "border": "rgba(255, 255, 255, 0.12)" } },
    { id: "dawn", name: "Dawn", mood: "warm plum, coral", tokens: {
      "bg": "#241a24", "bg-elevated": "#2f2230", "surface": "#291d29", "surface-hover": "#3a2b3a",
      "fg": "#f3e7ea", "fg-muted": "#b5929c", "accent": "#e39a7a", "accent-hover": "#f2b094",
      "fg-on-accent": "#241014", "grid-line": "rgba(255, 180, 190, 0.06)", "border": "rgba(255, 180, 190, 0.14)" } },
    { id: "day", name: "Day", mood: "bright, light, teal", light: true, tokens: {
      "bg": "#eceef2", "bg-elevated": "#ffffff", "surface": "#f4f6f9", "surface-hover": "#e4e8ef",
      "fg": "#1b1e26", "fg-muted": "#5a6172", "accent": "#2f8f76", "accent-hover": "#26765f",
      "fg-on-accent": "#ffffff", "grid-line": "rgba(0, 0, 0, 0.06)", "border": "rgba(0, 0, 0, 0.12)" } },
    { id: "dusk", name: "Dusk", mood: "golden hour", tokens: {
      "bg": "#241a16", "bg-elevated": "#30231c", "surface": "#291d18", "surface-hover": "#3a2b22",
      "fg": "#f3e9df", "fg-muted": "#b59d8a", "accent": "#e08a4a", "accent-hover": "#f0a05f",
      "fg-on-accent": "#1a0f08", "grid-line": "rgba(255, 180, 120, 0.06)", "border": "rgba(255, 180, 120, 0.14)" } },
    { id: "abyss",    name: "Abyss",    mood: "deep sea, phosphor green",  seed: { bg: "#0b1416", fg: "#d8ecec", accent: "#3ee8c0" } },
    { id: "rose",     name: "Rose",     mood: "wine dark, pink",           seed: { bg: "#1f1418", fg: "#f6e6ec", accent: "#ff7aa2" } },
    { id: "forest",   name: "Forest",   mood: "moss, leaf green",          seed: { bg: "#121a14", fg: "#e4efe4", accent: "#8bd17c" } },
    { id: "ember",    name: "Ember",    mood: "charcoal, orange",          seed: { bg: "#1c1210", fg: "#f4e8e0", accent: "#ff8a3d" } },
    { id: "lavender", name: "Lavender", mood: "ink violet, lilac",         seed: { bg: "#17141f", fg: "#ece6f6", accent: "#b48cff" } },
    { id: "mono",     name: "Mono",     mood: "black and white",           seed: { bg: "#111111", fg: "#ececec", accent: "#ffffff", "fg-on-accent": "#111111" } },
    { id: "paper",    name: "Paper",    mood: "warm light, red ink", light: true, seed: { bg: "#f5f1e8", fg: "#2a2622", accent: "#c0392b" } },
  ];
  for (const p of PRESETS) if (!p.tokens) p.tokens = derive(p.seed);

  /* ------------------------------- prefs ---------------------------------- */
  const prefs = () => (typeof Services !== "undefined" && Services.prefs) || null;
  function getStr(name, d) { try { return prefs().getStringPref(name, d); } catch (e) { return d; } }
  function setStr(name, v) { try { prefs().setStringPref(name, v); } catch (e) { console.warn("[Cthulhu:theme] pref", name, e.message); } }
  function getBool(name, d) { try { return prefs().getBoolPref(name, d); } catch (e) { return d; } }
  const getNum = (n) => { const v = parseFloat(getStr(n, "")); return isFinite(v) ? v : null; };

  /* ------------------------------ solar band ------------------------------ */
  // Standard "sunrise equation". Anchored at the location's LOCAL solar noon,
  // not `now`'s UTC day, so a western evening past 00:00 UTC still gets today's
  // sunrise/sunset (otherwise 21:00 EDT classifies as night instead of dusk).
  function sunTimes(lat, lng, date) {
    const offMs = (lng / 15) * 3600000;
    const local = new Date(date.getTime() + offMs);
    const anchor = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12, 0, 0) - offMs;
    const jd = anchor / 86400000 + 2440587.5;
    const n = Math.round(jd - 2451545.0 + 0.0008);
    const Jstar = n - lng / 360;
    const M = ((357.5291 + 0.98560028 * Jstar) % 360) * RAD;
    const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    const lambda = ((M + C) % (2 * Math.PI)) + (180 + 102.9372) * RAD;
    const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
    const delta = Math.asin(Math.sin(lambda) * Math.sin(23.44 * RAD));
    const latR = lat * RAD;
    const cosW = (Math.sin(-0.833 * RAD) - Math.sin(latR) * Math.sin(delta)) / (Math.cos(latR) * Math.cos(delta));
    if (cosW > 1) return { polar: "night" };
    if (cosW < -1) return { polar: "day" };
    const w = Math.acos(cosW) / (2 * Math.PI);
    const toDate = (J) => new Date((J - 2440587.5) * 86400000);
    return { sunrise: toDate(Jtransit - w), sunset: toDate(Jtransit + w) };
  }
  function timeBand(now, sun) {
    if (sun.polar) return sun.polar;
    const t = now.getTime(), rise = sun.sunrise.getTime(), set = sun.sunset.getTime(), H = 3600000;
    if (t >= rise - H && t < rise + H) return "dawn";
    if (t >= set - H && t < set + H) return "dusk";
    if (t >= rise + H && t < set - H) return "day";
    return "night";
  }
  function location() {
    const lat = getNum("cthulhu.ambient.latitude"), lng = getNum("cthulhu.ambient.longitude");
    return lat !== null && lng !== null ? { lat, lng } : DEFAULT_LOC;
  }
  function band(now) {
    const loc = location();
    return timeBand(now || new Date(), sunTimes(loc.lat, loc.lng, now || new Date()));
  }

  /* ------------------------------- resolve -------------------------------- */
  const byId = (id) => PRESETS.find((p) => p.id === id) || null;
  function current() {
    const v = getStr(PREF, "night");
    return v === AMBIENT || byId(v) ? v : "night";
  }
  function resolve(id) {
    id = id || current();
    if (id === AMBIENT) {
      const b = band();
      return { id: AMBIENT, band: b, preset: byId(b) || byId("night") };
    }
    return { id, band: null, preset: byId(id) || byId("night") };
  }
  function tokensCss(tokens) {
    return ":root {\n" + TOKENS.map((t) => "  --" + t + ": " + tokens[t] + ";").join("\n") + "\n}\n";
  }

  /* -------------------------------- apply --------------------------------- */
  function apply(doc) {
    doc = doc || document;
    const r = resolve();
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      // Last in the document so it wins the cascade over every linked sheet's
      // plain :root block; attribute-qualified rules (weather tweaks) still win.
      (doc.head || doc.documentElement).appendChild(style);
    }
    style.textContent = "/* " + r.preset.id + (r.band ? " via ambient/" + r.band : "") + " */\n" + tokensCss(r.preset.tokens);
    const root = doc.documentElement;
    root.setAttribute("cthulhu-theme", r.id);
    root.setAttribute("cthulhu-theme-resolved", r.preset.id);
    if (r.band) root.setAttribute("cthulhu-ambient-time", r.band);
    else root.removeAttribute("cthulhu-ambient-time");
    root.toggleAttribute("cthulhu-theme-light", !!r.preset.light);
    try {
      doc.dispatchEvent(new (doc.defaultView.CustomEvent)("cthulhu-theme-change", { detail: r }));
    } catch (e) {}
    return r;
  }

  /** Apply now, re-apply on pref change, and tick in ambient mode. Returns stop(). */
  function watch(doc) {
    doc = doc || document;
    const win = doc.defaultView;
    apply(doc);
    let timer = 0;
    const arm = () => {
      if (timer) { win.clearInterval(timer); timer = 0; }
      if (current() === AMBIENT) timer = win.setInterval(() => apply(doc), TICK_MS);
    };
    arm();
    const observer = { observe() { apply(doc); arm(); } };
    let observing = false;
    try { prefs().addObserver(PREF, observer); observing = true; } catch (e) {}
    const stop = () => {
      if (timer) win.clearInterval(timer);
      if (observing) { try { prefs().removeObserver(PREF, observer); } catch (e) {} observing = false; }
    };
    win.addEventListener("unload", stop, { once: true });
    return stop;
  }

  /* ------------------------------ favourites ------------------------------ */
  function favorites() {
    try { const v = JSON.parse(getStr(FAV_PREF, "[]")); return Array.isArray(v) ? v.filter(byId) : []; }
    catch (e) { return []; }
  }
  function setFavorites(list) { setStr(FAV_PREF, JSON.stringify([...new Set(list)])); }

  return {
    PREF, FAV_PREF, AMBIENT, TOKENS, color,
    presets: () => PRESETS.slice(),
    get: byId,
    current,
    resolve,
    /** Tokens currently in effect (ambient resolved), e.g. for a widget that
     *  wants the live accent as a hex string rather than var(--accent). */
    tokens: () => resolve().preset.tokens,
    setTheme(id) { if (id === AMBIENT || byId(id)) setStr(PREF, id); },
    favorites,
    isFavorite: (id) => favorites().includes(id),
    toggleFavorite(id) {
      const f = favorites();
      setFavorites(f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
      return !f.includes(id);
    },
    band, sunTimes, timeBand, location,
    apply, watch,
  };
})();
