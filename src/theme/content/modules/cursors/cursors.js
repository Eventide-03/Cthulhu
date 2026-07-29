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
})();
