/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Cthulhu feature-module loader.
 *
 * Bootstrapped by content/browser.js at chrome startup (loaded via
 * Services.scriptloader.loadSubScript into the browser window global). It:
 *   1. reads modules/index.json         (the registry: an array of module ids),
 *   2. reads each modules/<id>/manifest.json,
 *   3. resolves enabled = pref `cthulhu.module.<id>.enabled` if set, else
 *      manifest.enabled  (so features toggle from about:config, no rebuild),
 *   4. skips modules whose `mount` doesn't match this window's context,
 *   5. injects each enabled module's CSS (<link>) and JS (loadSubScript).
 *
 * Runs in the browser-window global, so `window`, `document`, `Services`, and
 * `ChromeUtils` are all available. Results are exposed on window.CthulhuLoader
 * (.loaded / .skipped) for inspection.
 * ============================================================================= */
"use strict";

window.CthulhuLoader = {
  BASE: "chrome://cthulhu/content/modules/",
  CONTEXT: "browser-window", // this loader instance runs in the main browser chrome
  loaded: [],
  skipped: [],

  async _json(url) {
    const resp = await window.fetch(url);
    if (!resp.ok) {
      throw new Error("HTTP " + resp.status + " for " + url);
    }
    return resp.json();
  },

  _isEnabled(manifest) {
    // Manifest flag is the ship default; the pref (if present on any branch)
    // overrides it, so a feature can be toggled without a rebuild.
    const pref = "cthulhu.module." + manifest.id + ".enabled";
    return Services.prefs.getBoolPref(pref, !!manifest.enabled);
  },

  _injectCSS(href) {
    const link = window.document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-cthulhu-module", "");
    window.document.documentElement.appendChild(link);
  },

  _injectJS(url) {
    Services.scriptloader.loadSubScript(url, window);
  },

  async load() {
    let ids = [];
    try {
      const index = await this._json(this.BASE + "index.json");
      ids = Array.isArray(index) ? index : index.modules || [];
    } catch (e) {
      console.error("[Cthulhu] could not read module index:", e);
      return;
    }
    for (const id of ids) {
      try {
        const dir = this.BASE + id + "/";
        const manifest = await this._json(dir + "manifest.json");
        manifest.id = manifest.id || id;

        if (!this._isEnabled(manifest)) {
          this.skipped.push({ id, reason: "disabled" });
          continue;
        }
        const mount = manifest.mount || "browser-window";
        if (mount !== this.CONTEXT && mount !== "all") {
          this.skipped.push({ id, reason: "mount:" + mount });
          continue;
        }
        if (manifest.css) {
          this._injectCSS(dir + manifest.css);
        }
        if (manifest.js) {
          this._injectJS(dir + manifest.js);
        }
        this.loaded.push({ id: manifest.id, mount });
        console.log("[Cthulhu] loaded module '" + id + "' (mount: " + mount + ")");
      } catch (e) {
        console.error("[Cthulhu] module '" + id + "' failed:", e);
        this.skipped.push({ id, reason: "error" });
      }
    }
    console.log(
      "[Cthulhu] loader done — enabled:",
      this.loaded.map(m => m.id),
      "| skipped:",
      this.skipped.map(s => s.id)
    );
  },
};
