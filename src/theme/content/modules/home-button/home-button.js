/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Turn the top-left "Firefox View" toolbar button into a Home button — and
 * fully suppress Firefox View. The Home button is bound to a single, pinned
 * about:cthulhu#home tab, toggled like Zen's pinned tabs: click to switch to
 * it if it's not focused, click again while it's focused to switch back to
 * whatever you were on before (the pinned tab itself is never removed by
 * this — it just stops being selected, same as clicking away from any other
 * pinned tab).
 *
 * The tab itself is marked [cthulhu-home-tab] and hidden from the strip via
 * CSS (home-button.css) -- the button IS the only visible affordance for it,
 * not a second icon next to a separate pinned-tab icon. It's still a fully
 * real, selectable tab underneath (session, history, the works); only its
 * rendering in the strip is suppressed. The button also reflects selection
 * (TabSelect below) so it visually acts like the tab itself: "active" while
 * you're on it, same as a selected tab looks different from an unselected one.
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

  // Per-window state: the pinned Home tab (once created) and the tab to
  // return to when toggling Home off. Re-checked live against gBrowser.tabs
  // each time rather than trusted blindly, so manually closing/unpinning the
  // Home tab (or its "previous tab") outside the button self-heals instead
  // of leaving this pointing at a dead <tab>.
  let homeTab = null;
  let previousTab = null;

  const btn = document.getElementById("firefox-view-button");

  function isLive(tab) {
    return !!tab && !tab.closing && window.gBrowser.tabs.includes(tab);
  }
  // Reflect selection onto the button. Also called directly right after this
  // module changes gBrowser.selectedTab itself (rather than relying solely on
  // the TabSelect listener below): addTab()'s own internal tab-select fires
  // TabSelect SYNCHRONOUSLY, before `homeTab = gBrowser.addTab(...)` has
  // finished assigning -- so at that moment the closure still sees the OLD
  // (null) homeTab and the listener alone would under-report "active".
  function updateActiveState() {
    if (btn) btn.toggleAttribute("cthulhu-home-active", isLive(homeTab) && window.gBrowser.selectedTab === homeTab);
  }

  let navigating = false;
  function goHome() {
    if (navigating) return;
    navigating = true;
    window.setTimeout(() => { navigating = false; }, 300);
    try {
      const gBrowser = window.gBrowser;
      if (isLive(homeTab)) {
        if (gBrowser.selectedTab === homeTab) {
          // Already there -- toggle off, back to what you were doing. Home
          // stays pinned/open; we just stop looking at it, like clicking
          // away from any other pinned tab.
          if (isLive(previousTab)) {
            gBrowser.selectedTab = previousTab;
          } else {
            // Nothing valid to return to (e.g. it was closed meanwhile) --
            // open a fresh tab rather than leaving no way back to browsing.
            window.BrowserCommands.openTab();
          }
          previousTab = null;
        } else {
          previousTab = gBrowser.selectedTab;
          gBrowser.selectedTab = homeTab;
        }
      } else {
        // Doesn't exist yet (or was closed/unpinned away) -- create it pinned.
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        previousTab = gBrowser.selectedTab;
        homeTab = gBrowser.addTab(HOME, {
          triggeringPrincipal: sp,
          pinned: true,
          inBackground: false,
        });
        homeTab.setAttribute("cthulhu-home-tab", "1"); // hidden from the strip; see home-button.css
      }
    } catch (err) {
      console.error("[Cthulhu:" + ID + "] navigation failed:", err);
    }
    updateActiveState();
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

  // cosmetic: relabel the button as Home, and keep its active state in sync
  // when the user switches tabs directly (not via this button) -- e.g.
  // clicking away to a different tab, or back to Home, from the tab strip
  // itself. The goHome()-triggered switches call updateActiveState() directly
  // (see above); this covers everything else.
  if (btn) {
    btn.setAttribute("tooltiptext", "Home");
    btn.setAttribute("aria-label", "Home");
    btn.dataset.cthulhuHome = "1";
    window.gBrowser.tabContainer.addEventListener("TabSelect", updateActiveState);
  }
})();
