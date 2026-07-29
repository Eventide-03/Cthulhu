/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Cthulhu "example" feature module — scaffold + a sprite-pipeline demo.
 * Loaded by the module loader (loadSubScript into the browser window) only when
 * enabled. IIFE-wrapped so a module never collides on the shared window global.
 * Available in here: window, document, gBrowser, Services, ChromeUtils, and the
 * shared window.CthulhuSprite helper. */
(function () {
  "use strict";
  const ID = "example";
  console.log("[Cthulhu:" + ID + "] init");

  // Loader-wiring marker (verified by the module tests).
  document.documentElement.setAttribute("cthulhu-module-example", "active");

  // --- Sprite pipeline demo -------------------------------------------------
  // Plays the placeholder Aseprite export from this module's assets/ as a small
  // floating badge. This is exactly how a real feature plays its own art: drop
  // <name>.png + <name>.json into assets/, list them in theme/jar.mn, then call
  // CthulhuSprite.fromAseprite(el, ".../<name>.json"). Remove/replace freely.
  try {
    const sprite = document.createElement("div");
    sprite.id = "cthulhu-example-sprite";
    // Float it unobtrusively so it renders without disturbing toolbar layout.
    Object.assign(sprite.style, {
      position: "fixed",
      top: "6px",
      insetInlineEnd: "6px",
      transform: "scale(2)",
      transformOrigin: "top right",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(sprite);

    if (window.CthulhuSprite) {
      window.CthulhuSprite.fromAseprite(
        sprite,
        "chrome://cthulhu/content/modules/example/assets/idle.json",
        { mode: "css" }
      ).catch(e => console.error("[Cthulhu:" + ID + "] sprite play failed:", e));
    }
  } catch (e) {
    console.error("[Cthulhu:" + ID + "] demo failed:", e);
  }
})();
