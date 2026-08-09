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
 * Firefox View is fully suppressed: rather than intercepting DOM events on
 * the button (fragile -- that approach silently broke across a Firefox
 * version bump when the button's own event wiring changed upstream), this
 * patches FirefoxViewHandler's own two entry-point methods directly. Every
 * built-in way to open Firefox View -- the toolbar button, the menu bar item,
 * keyboard shortcuts/commands, the Library "Firefox View" command, and a
 * couple of internal tabbrowser call sites -- all funnel through
 * FirefoxViewHandler.openTab()/openToolbarMouseEvent() (confirmed by
 * searching every call site of those two methods in the engine tree), so
 * patching them covers all of those uniformly and is resilient to future
 * event-wiring changes upstream. A tabs progress-listener safety net below
 * also catches about:firefoxview being reached any OTHER way (typed in the
 * URL bar, a bookmark, session restore) and redirects it to Home too. */
(function () {
  "use strict";
  const ID = "home-button";
  const HOME = "about:cthulhu#home";
  const FXVIEW = "about:firefoxview";

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

  // Pinned tabs persist across restarts independent of the startup pref (a
  // Firefox behavior, not something we opted into) -- so on the very next
  // launch after this module ever creates the Home tab, SessionStore
  // restores it on its own, via its own tab-creation path, before this
  // module gets a chance to run goHome() again. That restored tab never
  // gets the [cthulhu-home-tab] marker (SessionStore doesn't know about our
  // custom attribute), so home-button.css's hiding rule doesn't match it and
  // it briefly (or persistently) shows up as a plain visible pinned tab --
  // confirmed live: after a real quit+relaunch with a pinned home tab, the
  // restored tab had `hasAttribute("cthulhu-home-tab") === false` and
  // `display: flex`. Adopt any pre-existing about:cthulhu#home tab up front,
  // before anything else runs, so it's never visible even momentarily.
  function adoptExistingHomeTab() {
    const gBrowser = window.gBrowser;
    for (const tab of gBrowser.tabs) {
      const uri = tab.linkedBrowser?.currentURI;
      if (uri && uri.spec === HOME) {
        homeTab = tab;
        tab.setAttribute("cthulhu-home-tab", "1");
        if (!tab.pinned) gBrowser.pinTab(tab); // defensive: should already be pinned, but enforce the invariant
        return;
      }
    }
  }
  adoptExistingHomeTab();
  updateActiveState(); // in case the adopted tab is already the selected one at startup (function declaration, hoisted -- fine to call ahead of its definition below)
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

  // Patch the shared handler's two entry points directly -- see the header
  // comment for why this covers every built-in trigger uniformly. Firefox's
  // own browser.js defines FirefoxViewHandler at the top level of a
  // synchronously-loaded script (global-scripts.js's loadSubScript), which
  // runs before this file (see browser.xhtml's script order), so it's always
  // defined by the time this runs.
  if (window.FirefoxViewHandler) {
    window.FirefoxViewHandler.openTab = function () {
      goHome();
    };
    window.FirefoxViewHandler.openToolbarMouseEvent = function (event) {
      if (event?.type === "mousedown" && event?.button !== 0) return;
      goHome();
    };
  } else {
    console.error("[Cthulhu:" + ID + "] FirefoxViewHandler not found -- Firefox View suppression disabled");
  }

  // Safety net: about:firefoxview reached any OTHER way (typed in the URL
  // bar, a bookmark, an extension, session restore) bypasses
  // FirefoxViewHandler entirely, so redirect it at the navigation level too
  // -- whatever tab tries to load it loads Home instead, in place. Not
  // wired into the singleton pinned-tab bookkeeping above: a stray tab
  // loading this URL shouldn't suddenly become "the" managed Home tab.
  const fxviewGuard = {
    onLocationChange(aBrowser, aWebProgress, aRequest, aLocationURI) {
      if (!aWebProgress.isTopLevel || !aLocationURI) return;
      const spec = aLocationURI.spec;
      if (spec !== FXVIEW && !spec.startsWith(FXVIEW + "#")) return;
      try {
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        aBrowser.fixupAndLoadURIString(HOME, { triggeringPrincipal: sp });
      } catch (err) {
        console.error("[Cthulhu:" + ID + "] fxview redirect failed:", err);
      }
    },
  };
  window.gBrowser.addTabsProgressListener(fxviewGuard);
  window.addEventListener(
    "unload",
    () => window.gBrowser.removeTabsProgressListener(fxviewGuard),
    { once: true }
  );

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
