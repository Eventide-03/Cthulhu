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

  // Load the shared sprite helper (defines window.CthulhuSprite) so modules can
  // use it, then bootstrap the feature-module loader and run it. The loader
  // discovers modules from modules/index.json and injects the enabled ones.
  try {
    Services.scriptloader.loadSubScript(
      "chrome://cthulhu/content/sprite.js",
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
