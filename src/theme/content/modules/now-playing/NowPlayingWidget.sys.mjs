/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Registers the "Now Playing" toolbar widget exactly once per process (ES
 * modules are singletons, and CustomizableUI.getWidget(id)?.provider is NOT a
 * reliable "have I already called createWidget()" check -- Firefox's own
 * comment on getWidgetProvider(): it optimistically guesses PROVIDER_XUL for
 * literally any unrecognized id, "the API is technically lying").
 *
 * onBuild is a thin pass-through: the DOM-building logic lives per-window in
 * now-playing.js (it needs that window's own tracker), exposed as
 * window.__cthulhuBuildNowPlayingItem. By the time CustomizableUI calls
 * onBuild(doc) for any given window, that window's copy of now-playing.js has
 * already run (loadSubScript is synchronous, and runs before this module's
 * dynamic import resolves), so the hook is always there.
 *
 * The widget id is unchanged from the former side-panels module, so a profile
 * that already had it placed keeps its position.
 *
 * defaultArea only auto-places a widget into the window that's open at the
 * moment of its FIRST-EVER registration in a profile; by the time this runs
 * that window's toolbar has already finished its initial build pass, so the
 * widget doesn't get inserted retroactively (confirmed live). Placing it
 * explicitly, immediately before the extensions button, fixes the current
 * window; any window opened after this module has run picks it up through
 * its own normal startup. */

// Firefox moved this module's canonical import path from resource:///modules/
// to moz-src:// (a source-tree-relative scheme); the old alias no longer
// resolves for this specific file.
const { CustomizableUI } = ChromeUtils.importESModule(
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
);

try {
  CustomizableUI.createWidget({
    id: "cthulhu-nowplaying",
    type: "custom",
    defaultArea: CustomizableUI.AREA_NAVBAR,
    removable: true,
    onBuild(doc) {
      return doc.defaultView.__cthulhuBuildNowPlayingItem(doc);
    },
  });
} catch (e) {
  console.error("[Cthulhu:now-playing] createWidget failed:", e);
}

// Place it before the extensions button. At the moment this module first
// runs the navbar's saved placements may not be restored yet, in which case
// getWidgetIdsInArea throws "Area nav-bar not yet restored"; that is not a
// failure, only "too early" -- wait for the area and place it then.
function place() {
  let placements;
  try {
    placements = CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR) || [];
  } catch (e) {
    return false;
  }
  try {
    if (!placements.includes("cthulhu-nowplaying")) {
      const idx = placements.indexOf("unified-extensions-button");
      CustomizableUI.addWidgetToArea("cthulhu-nowplaying", CustomizableUI.AREA_NAVBAR, idx >= 0 ? idx : undefined);
    }
  } catch (e) {
    console.error("[Cthulhu:now-playing] placing widget failed:", e);
  }
  return true;
}
if (!place()) {
  const listener = {
    onAreaNodeRegistered(area) {
      if (area !== CustomizableUI.AREA_NAVBAR) return;
      CustomizableUI.removeListener(listener);
      place();
    },
  };
  CustomizableUI.addListener(listener);
}

// The tab-volume actor: there is no per-tab volume level in Gecko's chrome
// API, so the player's slider sets `volume` on the page's media elements from
// inside the content process. Scoped to ordinary tabs' browsers; the child
// hears `play` (captured, so elements the page creates later are caught) and
// `pageshow` (to re-ask after a navigation).
try {
  ChromeUtils.registerWindowActor("CthulhuTabVolume", {
    parent: {
      esModuleURI: "chrome://cthulhu/content/modules/now-playing/CthulhuTabVolumeParent.sys.mjs",
    },
    child: {
      esModuleURI: "chrome://cthulhu/content/modules/now-playing/CthulhuTabVolumeChild.sys.mjs",
      events: { play: { capture: true }, pageshow: {} },
    },
    messageManagerGroups: ["browsers"],
    allFrames: true,
  });
} catch (e) {
  if (!/already/i.test(String(e))) {
    console.error("[Cthulhu:now-playing] tab-volume actor registration failed:", e);
  }
}
