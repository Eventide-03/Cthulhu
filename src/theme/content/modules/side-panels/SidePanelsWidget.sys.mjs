/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Registers the "Now Playing" toolbar widget exactly once per process (ES
 * modules are singletons -- see side-panels.js for why that guarantee
 * matters here specifically: CustomizableUI.getWidget(id)?.provider is NOT a
 * reliable "have I already called createWidget()" check).
 *
 * onBuild is a thin, generic pass-through: the actual DOM-building logic
 * lives per-window in side-panels.js (it needs that window's own
 * setupSidePanels()/setupNowPlaying() closures), exposed as
 * window.__cthulhuBuildSidePanelsItem. By the time CustomizableUI calls
 * onBuild(doc) for any given window, that window's copy of side-panels.js
 * has already run (loadSubScript is synchronous, and runs before this
 * module's dynamic import resolves), so the hook is always there.
 *
 * defaultArea only auto-places a widget into the window that's open at the
 * moment of its FIRST-EVER registration in a profile; by the time this runs
 * (module loading here happens well after the navbar is constructed), that
 * window's toolbar has already finished its initial build pass, so the
 * widget doesn't get inserted retroactively (confirmed live: provider
 * reported "xul" -- CustomizableUI's placement bookkeeping knew about it,
 * but no DOM node was ever built). Placing it explicitly, immediately before
 * the extensions button, fixes the current window; any window opened after
 * this module has already run picks it up automatically via its own normal
 * startup (registerToolbarNode's dirty-area check includes "does this area's
 * placements list contain an API-registered widget"). */

// Firefox moved this module's canonical import path from resource:///modules/
// to moz-src:// (a source-tree-relative scheme) at some point after this
// project's original Firefox 140 base -- confirmed via how Firefox's own code
// (e.g. CustomizeMode.sys.mjs) imports it now. The old resource:// alias no
// longer resolves for this specific file.
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
      return doc.defaultView.__cthulhuBuildSidePanelsItem(doc);
    },
  });
} catch (e) {
  console.error("[Cthulhu:side-panels] createWidget failed:", e);
}

try {
  const placements = CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR) || [];
  if (!placements.includes("cthulhu-nowplaying")) {
    const idx = placements.indexOf("unified-extensions-button");
    CustomizableUI.addWidgetToArea("cthulhu-nowplaying", CustomizableUI.AREA_NAVBAR, idx >= 0 ? idx : undefined);
  }
} catch (e) {
  console.error("[Cthulhu:side-panels] placing widget failed:", e);
}

// Best-effort Discord UI simplification (see CthulhuDiscordSimplifyChild.sys.mjs
// for the caveats). Scoped via messageManagerGroups to ONLY the side-panel
// <browser>s (side-panels.js sets messagemanagergroup="cthulhu-sidepanels" on
// each one) -- never runs against ordinary tabs.
try {
  ChromeUtils.registerWindowActor("CthulhuDiscordSimplify", {
    child: {
      esModuleURI: "chrome://cthulhu/content/modules/side-panels/CthulhuDiscordSimplifyChild.sys.mjs",
      events: { DOMContentLoaded: {} },
    },
    messageManagerGroups: ["cthulhu-sidepanels"],
    allFrames: true,
  });
} catch (e) {
  if (!/already/i.test(String(e))) {
    console.error("[Cthulhu:side-panels] Discord-simplify actor registration failed:", e);
  }
}
