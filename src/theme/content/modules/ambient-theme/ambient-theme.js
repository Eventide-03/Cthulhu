/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Ambient theme module.
 *
 * Applies the browser-wide theme to this window and, when the theme is
 * "ambient", layers the weather on top:
 *
 *   palette  -> content/themes.js (window.CthulhuThemes): reads the pref
 *               `cthulhu.theme`, picks a preset or the time-of-day band
 *               (dawn/day/dusk/night, local solar formula, no API), and swaps
 *               the A2 tokens. The Theme widget on the home page writes the
 *               pref; the engine keeps every window and page in step.
 *   weather  -> Open-Meteo current weather_code -> clear/cloudy/rain/snow/storm
 *               as an attribute on :root (ambient-theme.css derives colour
 *               tweaks from the CURRENT tokens) plus a rain/snow overlay drawn
 *               by the sprite helper. Only in ambient mode; only if
 *               cthulhu.ambient.weather.enabled.
 *
 * Location: pref (cthulhu.ambient.latitude / .longitude) first; optional
 * geolocation (cthulhu.ambient.geolocation=true) as a fallback, whose result is
 * written to those same prefs so the home page computes the same band.
 *
 * PRIVACY: weather is the only part that touches the network. Setting
 * cthulhu.ambient.weather.enabled=false skips the Open-Meteo request entirely,
 * so no coordinates ever leave the machine. See PRIVACY.md.
 * ============================================================================= */
(function () {
  "use strict";
  const win = window;
  const doc = win.document;
  const ID = "ambient-theme";
  const ASSET = "chrome://cthulhu/content/modules/ambient-theme/assets/";
  const T = win.CthulhuThemes;
  if (!T) { console.error("[Cthulhu:" + ID + "] themes.js not loaded"); return; }

  const WEATHER_REFRESH_MS = 30 * 60 * 1000;
  const P = Services.prefs;
  const getStr = (n, d) => { try { return P.getStringPref(n, d); } catch (e) { return d; } };
  const getBool = (n, d) => { try { return P.getBoolPref(n, d); } catch (e) { return d; } };
  const WEATHER_PREF = "cthulhu.ambient.weather.enabled";
  const weatherEnabled = () => getBool(WEATHER_PREF, true);

  // --- palette: hand the window to the engine ---------------------------------
  T.watch(doc);

  // --- location: optional geolocation, persisted so every consumer agrees ----
  function resolveLocation() {
    const has = getStr("cthulhu.ambient.latitude", "") && getStr("cthulhu.ambient.longitude", "");
    if (has || !getBool("cthulhu.ambient.geolocation", false) || !win.navigator.geolocation) return;
    try {
      win.navigator.geolocation.getCurrentPosition(
        (p) => {
          try {
            P.setStringPref("cthulhu.ambient.latitude", String(p.coords.latitude));
            P.setStringPref("cthulhu.ambient.longitude", String(p.coords.longitude));
            T.apply(doc);
          } catch (e) {}
        },
        () => {},
        { timeout: 5000, maximumAge: 3600000 }
      );
    } catch (e) {}
  }

  // --- weather (Open-Meteo, cached in a pref, graceful offline) --------------
  function weatherGroup(code) {
    if (code === 0 || code === 1) return "clear";
    if (code === 2 || code === 3 || code === 45 || code === 48) return "cloudy";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "clear";
  }
  async function weather(lat, lng) {
    const CACHE = "cthulhu.ambient.weather.cache";
    try {
      const cached = JSON.parse(getStr(CACHE, "null"));
      if (cached && win.Date.now() - cached.ts < WEATHER_REFRESH_MS) return cached.group;
    } catch (e) {}
    try {
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng + "&current=weather_code";
      const r = await win.fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const group = weatherGroup((await r.json()).current.weather_code);
      try { P.setStringPref(CACHE, JSON.stringify({ group, ts: win.Date.now() })); } catch (e) {}
      return group;
    } catch (e) {
      console.warn("[Cthulhu:" + ID + "] weather offline; time-of-day only:", e.message);
      try { const c = JSON.parse(getStr(CACHE, "null")); if (c) return c.group; } catch (e2) {}
      return null;
    }
  }
  function updateOverlay(group) {
    const want = group === "rain" || group === "snow" || group === "storm";
    let el = doc.getElementById("cthulhu-ambient-overlay");
    if (!want) { if (el) el.remove(); return; }
    if (!el) { el = doc.createElement("div"); el.id = "cthulhu-ambient-overlay"; doc.documentElement.appendChild(el); }
    const sprite = group === "snow" ? "snow" : "rain"; // storm reuses rain
    if (el.dataset.weather !== sprite && win.CthulhuSprite) {
      el.dataset.weather = sprite;
      win.CthulhuSprite.fromAseprite(el, ASSET + sprite + ".json", { mode: "css" })
        .then(() => { el.style.width = ""; el.style.height = ""; })
        .catch((e) => console.warn("[Cthulhu:" + ID + "] overlay art missing (" + sprite + "):", e.message));
    }
  }
  function clearWeather() {
    doc.documentElement.removeAttribute("cthulhu-ambient-weather");
    updateOverlay(null);
  }
  async function applyWeather() {
    if (T.current() !== T.AMBIENT || !weatherEnabled()) { clearWeather(); return; }
    const loc = T.location();
    const group = await weather(loc.lat, loc.lng);
    if (group) doc.documentElement.setAttribute("cthulhu-ambient-weather", group);
    else doc.documentElement.removeAttribute("cthulhu-ambient-weather");
    updateOverlay(group);
  }

  // --- init -----------------------------------------------------------------
  resolveLocation();
  applyWeather();
  const timer = win.setInterval(applyWeather, WEATHER_REFRESH_MS);
  const onTheme = () => applyWeather(); // entering/leaving ambient mode
  doc.addEventListener("cthulhu-theme-change", onTheme);
  win.addEventListener("unload", () => { win.clearInterval(timer); doc.removeEventListener("cthulhu-theme-change", onTheme); }, { once: true });
  console.log("[Cthulhu:" + ID + "] theme:", T.current(), T.current() === T.AMBIENT ? "(band " + T.band() + ")" : "",
    weatherEnabled() ? "" : "(weather off)");
})();
