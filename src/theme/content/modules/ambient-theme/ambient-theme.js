/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Ambient theme module.
 *
 * Rethemes the browser from three locally-computed / cheaply-fetched inputs by
 * SWAPPING the A2 theme variables (via attributes consumed by ambient-theme.css)
 * and selecting art frames — never by hardcoding colors:
 *   1. time of day  -> local sunrise/sunset (solar formula, no API) -> dawn/day/dusk/night
 *   2. weather       -> Open-Meteo current weather_code -> clear/cloudy/rain/snow/storm
 *   3. moon phase    -> synodic-age formula -> a frame in the moon-phase art strip
 *
 * Location: user pref (cthulhu.ambient.latitude / .longitude) first; optional
 * geolocation (cthulhu.ambient.geolocation=true) as a fallback.
 * Runs in the browser-window scope; uses the A4 sprite helper (window.CthulhuSprite).
 * ============================================================================= */
(function () {
  "use strict";
  const win = window;
  const doc = win.document;
  const ID = "ambient-theme";
  const ASSET = "chrome://cthulhu/content/modules/ambient-theme/assets/";
  const RAD = Math.PI / 180;

  const MOON_FRAMES = 8;   // frames in assets/moon.png (author to match)
  const MOON_SIZE = 32;    // px per moon frame
  const TIME_REFRESH_MS = 5 * 60 * 1000;    // re-evaluate the time band
  const WEATHER_REFRESH_MS = 30 * 60 * 1000; // refresh weather
  const DEFAULT_LOC = { lat: 40.7128, lng: -74.006 }; // placeholder (set the prefs!)

  // --- prefs ----------------------------------------------------------------
  const P = Services.prefs;
  const getStr = (n, d) => { try { return P.getStringPref(n, d); } catch (e) { return d; } };
  const getBool = (n, d) => { try { return P.getBoolPref(n, d); } catch (e) { return d; } };
  const getNum = (n) => { const v = parseFloat(getStr(n, "")); return isFinite(v) ? v : null; };

  function getLocation() {
    const lat = getNum("cthulhu.ambient.latitude");
    const lng = getNum("cthulhu.ambient.longitude");
    if (lat !== null && lng !== null) return Promise.resolve({ lat, lng });
    if (getBool("cthulhu.ambient.geolocation", false) && win.navigator.geolocation) {
      return new Promise(res => {
        try {
          win.navigator.geolocation.getCurrentPosition(
            p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => res(DEFAULT_LOC),
            { timeout: 5000, maximumAge: 3600000 }
          );
        } catch (e) { res(DEFAULT_LOC); }
      });
    }
    return Promise.resolve(DEFAULT_LOC);
  }

  // --- 1. solar: sunrise/sunset (standard "sunrise equation") ----------------
  function sunTimes(lat, lng, date) {
    // Anchor the day number at the location's LOCAL solar noon (derived from the
    // longitude offset), not `now`'s UTC day. Otherwise a western-hemisphere
    // evening that has crossed 00:00 UTC rounds to the next solar day and the
    // sunrise/sunset it returns belong to the wrong day (e.g. 21:00 EDT would
    // classify as night instead of dusk).
    const offMs = (lng / 15) * 3600000;
    const local = new Date(date.getTime() + offMs);
    const anchor = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
                            local.getUTCDate(), 12, 0, 0) - offMs;
    const jd = anchor / 86400000 + 2440587.5;                 // Unix ms -> Julian Date
    const n = Math.round(jd - 2451545.0 + 0.0008);            // days since J2000
    const Jstar = n - lng / 360;                              // mean solar noon
    const M = ((357.5291 + 0.98560028 * Jstar) % 360) * RAD;  // solar mean anomaly
    const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    const lambda = ((M + C) % (2 * Math.PI)) + (180 + 102.9372) * RAD; // ecliptic longitude
    const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
    const delta = Math.asin(Math.sin(lambda) * Math.sin(23.44 * RAD)); // declination
    const latR = lat * RAD;
    const cosW = (Math.sin(-0.833 * RAD) - Math.sin(latR) * Math.sin(delta)) /
      (Math.cos(latR) * Math.cos(delta));
    if (cosW > 1) return { polar: "night" };   // sun stays down
    if (cosW < -1) return { polar: "day" };     // sun stays up
    const w = Math.acos(cosW) / (2 * Math.PI); // fraction of a day
    const toDate = J => new Date((J - 2440587.5) * 86400000);
    return { sunrise: toDate(Jtransit - w), sunset: toDate(Jtransit + w) };
  }

  function timeBand(now, sun) {
    if (sun.polar) return sun.polar; // polar day/night
    const t = now.getTime(), rise = sun.sunrise.getTime(), set = sun.sunset.getTime(), H = 3600000;
    if (t >= rise - H && t < rise + H) return "dawn";
    if (t >= set - H && t < set + H) return "dusk";
    if (t >= rise + H && t < set - H) return "day";
    return "night";
  }

  // --- 3. moon phase (synodic age) ------------------------------------------
  function moonFrame(date) {
    const SYN = 29.530588853;
    const jd = date.getTime() / 86400000 + 2440587.5;
    let age = (jd - 2451550.1) % SYN;          // 2451550.1 = a known new moon (JD)
    if (age < 0) age += SYN;
    const phase = age / SYN;                    // 0 = new, .5 = full
    return Math.round(phase * MOON_FRAMES) % MOON_FRAMES;
  }

  // --- 2. weather (Open-Meteo, cached in a pref, graceful offline) -----------
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
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
        "&longitude=" + lng + "&current=weather_code";
      const r = await win.fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const group = weatherGroup((await r.json()).current.weather_code);
      try { P.setStringPref(CACHE, JSON.stringify({ group, ts: win.Date.now() })); } catch (e) {}
      return group;
    } catch (e) {
      console.warn("[Cthulhu:" + ID + "] weather offline; using time-of-day only:", e.message);
      try { const c = JSON.parse(getStr(CACHE, "null")); if (c) return c.group; } catch (e2) {}
      return null; // graceful: no weather variant/overlay
    }
  }

  // --- DOM: celestial body + weather overlay --------------------------------
  function celestial() {
    let el = doc.getElementById("cthulhu-ambient-celestial");
    if (!el) { el = doc.createElement("div"); el.id = "cthulhu-ambient-celestial"; doc.documentElement.appendChild(el); }
    return el;
  }
  function updateCelestial(band, frame) {
    const el = celestial();
    if (band === "day" || band === "dawn") {
      el.style.backgroundImage = 'url("' + ASSET + 'sun.png")';
      el.style.backgroundPositionX = "0px";
    } else {
      el.style.backgroundImage = 'url("' + ASSET + 'moon.png")';
      el.style.backgroundPositionX = -frame * MOON_SIZE + "px";
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
        // The helper sizes the element to one frame; clear that so the overlay
        // stays full-window and the animation scrolls the tiled rain texture.
        .then(() => { el.style.width = ""; el.style.height = ""; })
        .catch(e => console.warn("[Cthulhu:" + ID + "] overlay art missing (" + sprite + "):", e.message));
    }
  }

  // --- apply ----------------------------------------------------------------
  let loc = DEFAULT_LOC;
  function applyTime() {
    const now = new Date();
    const band = timeBand(now, sunTimes(loc.lat, loc.lng, now));
    doc.documentElement.setAttribute("cthulhu-ambient-time", band);
    updateCelestial(band, moonFrame(now));
    return band;
  }
  async function applyWeather() {
    const group = await weather(loc.lat, loc.lng);
    if (group) { doc.documentElement.setAttribute("cthulhu-ambient-weather", group); }
    else { doc.documentElement.removeAttribute("cthulhu-ambient-weather"); }
    updateOverlay(group);
    return group;
  }

  // --- init -----------------------------------------------------------------
  (async () => {
    try {
      loc = await getLocation();
      applyTime();
      await applyWeather();
      win.setInterval(applyTime, TIME_REFRESH_MS);
      win.setInterval(applyWeather, WEATHER_REFRESH_MS);
      console.log("[Cthulhu:" + ID + "] active @", loc.lat.toFixed(2), loc.lng.toFixed(2));
    } catch (e) {
      console.error("[Cthulhu:" + ID + "] init failed:", e);
    }
  })();
})();
