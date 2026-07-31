/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Turn the top-left "Firefox View" toolbar button into a Home button that opens
 * the Cthulhu home grid (about:cthulhu#home) — and fully suppress Firefox View.
 *
 * FirefoxViewHandler opens the view on MOUSEDOWN, and its listener is attached
 * at startup (before this module). So we intercept at the WINDOW in the capture
 * phase — which runs ahead of the button's own listeners — for mousedown, click
 * and command, and cancel them. Navigation happens once per activation. */
(function () {
  "use strict";
  const ID = "home-button";
  const HOME = "about:cthulhu#home";

  const isViewButton = (t) => {
    try { return t && t.closest && t.closest("#firefox-view-button"); }
    catch (e) { return false; }
  };

  let navigating = false;
  function goHome() {
    if (navigating) return;
    navigating = true;
    window.setTimeout(() => { navigating = false; }, 300);
    try {
      const sp = Services.scriptSecurityManager.getSystemPrincipal();
      window.gBrowser.selectedBrowser.fixupAndLoadURIString(HOME, { triggeringPrincipal: sp });
    } catch (err) {
      console.error("[Cthulhu:" + ID + "] navigation failed:", err);
    }
  }

  function intercept(navigate) {
    return (e) => {
      if (!isViewButton(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (navigate) goHome();
    };
  }
  // mousedown: only suppress (this is what opens Firefox View). click/command:
  // suppress AND navigate (covers mouse and keyboard activation).
  window.addEventListener("mousedown", intercept(false), true);
  window.addEventListener("click", intercept(true), true);
  window.addEventListener("command", intercept(true), true);

  // cosmetic: relabel the button as Home
  const btn = document.getElementById("firefox-view-button");
  if (btn) {
    btn.setAttribute("tooltiptext", "Home");
    btn.setAttribute("aria-label", "Home");
    btn.dataset.cthulhuHome = "1";
  }
})();
