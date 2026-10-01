/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Cursor theme module.
 *
 * Registers cursors.css as a global USER_SHEET via nsIStyleSheetService, so the
 * cursor rules apply to BOTH the browser chrome and web content in one shot.
 * (The module loader's per-window <link> injection only reaches chrome, which is
 * why this module uses the sheet service instead — hence no "css" in manifest.)
 *
 * The sheet is process-global, so we register it only once even though this runs
 * per browser window. */
(function () {
  "use strict";
  const SHEET = "chrome://cthulhu/content/modules/cursors/cursors.css";
  try {
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
      Ci.nsIStyleSheetService
    );
    const uri = Services.io.newURI(SHEET);
    if (!sss.sheetRegistered(uri, sss.USER_SHEET)) {
      sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
      console.log("[Cthulhu:cursors] registered global cursor sheet");
    }
  } catch (e) {
    console.error("[Cthulhu:cursors] failed to register cursor sheet:", e);
  }

  /* The pointer's auto-hide over video. It belongs with the cursor theme
   * because the theme is what broke it: a user-origin !important rule
   * outranks the `cursor: none` every video site sets for itself. See
   * CthulhuCursorIdleChild for the whole story.
   *
   * Registered here rather than in a module of its own for the same reason
   * the sheet is: this file already runs once per browser window and the
   * registration is process-global, so the second call throws "already
   * registered" and that is the only "have I done this" signal there is.
   *
   * allFrames, because a video is as likely to be in an embed as in the page
   * itself; the attribute lands on that frame's own root, which is exactly
   * the area the pointer is over. */
  try {
    ChromeUtils.registerWindowActor("CthulhuCursorIdle", {
      child: {
        esModuleURI: "chrome://cthulhu/content/modules/cursors/CthulhuCursorIdleChild.sys.mjs",
        events: {
          play: { capture: true, mozSystemGroup: true },
          pause: { capture: true, mozSystemGroup: true },
          ended: { capture: true, mozSystemGroup: true },
          fullscreenchange: { capture: true, mozSystemGroup: true },
        },
      },
      messageManagerGroups: ["browsers"],
      allFrames: true,
    });
  } catch (e) {
    if (!/already/i.test(String(e))) {
      console.error("[Cthulhu:cursors] cursor-idle actor registration failed:", e);
    }
  }
})();
