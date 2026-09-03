/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Cthulhu chrome entry point. Injected into the browser chrome (browser.xhtml)
 * via:
 *   <script src="chrome://cthulhu/content/browser.js">
 * Runs in the browser-window scope. Marks the document (injection smoke test)
 * and bootstraps the feature-module loader. */
(function () {
  "use strict";
  try {
    document.documentElement.setAttribute("cthulhu-chrome-js", "loaded");
  } catch (e) {}

  // Register about:cthulhu (home / new-tab page) once per process. ES modules
  // are singletons, so importing here from every window still registers a
  // single time; the module also guards on its component CID.
  try {
    ChromeUtils.importESModule(
      "chrome://cthulhu/content/newtab/AboutCthulhu.sys.mjs"
    );
  } catch (e) {
    console.error("[Cthulhu] about:cthulhu registration failed:", e);
  }

  // Force caret browsing OFF (overrides a profile value that a stray F7 may have
  // set — a default pref alone can't undo an existing user value).
  try {
    Services.prefs.setBoolPref("accessibility.browsewithcaret", false);
  } catch (e) {}

  // macOS: quit the app when the last browser window closes (any tab,
  // including the home page), instead of the platform default of lingering
  // in the dock with no windows. No-op on other platforms. Once per process.
  try {
    ChromeUtils.importESModule(
      "chrome://cthulhu/content/QuitOnLastWindowClose.sys.mjs"
    );
  } catch (e) {
    console.error("[Cthulhu] quit-on-last-window-close init failed:", e);
  }

  // Opera-GX-style file picker: intercept <input type=file> clicks browser-wide
  // (recent files + clipboard paste + native picker). Parent-side setup runs
  // once per process (ES module singleton) and loads the content frame script.
  try {
    ChromeUtils.importESModule(
      "chrome://cthulhu/content/newtab/FilePicker.sys.mjs"
    );
  } catch (e) {
    console.error("[Cthulhu] file picker init failed:", e);
  }

  // Load the shared sprite helper (defines window.CthulhuSprite) so modules can
  // use it, then bootstrap the feature-module loader and run it. The loader
  // discovers modules from modules/index.json and injects the enabled ones.
  try {
    Services.scriptloader.loadSubScript(
      "chrome://cthulhu/content/sprite.js",
      window
    );
    // Theme engine (window.CthulhuThemes): the ambient-theme module applies it
    // to this window and keeps it in sync with the cthulhu.theme pref.
    Services.scriptloader.loadSubScript(
      "chrome://cthulhu/content/themes.js",
      window
    );
    Services.scriptloader.loadSubScript(
      "chrome://cthulhu/content/loader.js",
      window
    );
    window.CthulhuLoader.load();
  } catch (e) {
    console.error("[Cthulhu] chrome bootstrap failed:", e);
  }
})();
