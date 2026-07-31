/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Registers the CthulhuFilePicker JSWindowActor (Fission-safe) that intercepts
 * <input type=file> clicks in web content and shows the Opera-GX-style picker
 * (recent files + clipboard paste + native "Show all files"). Imported once per
 * process from browser.js — ES modules are singletons, so registration runs once. */

try {
  ChromeUtils.registerWindowActor("CthulhuFilePicker", {
    parent: {
      esModuleURI: "chrome://cthulhu/content/newtab/CthulhuFilePickerParent.sys.mjs",
    },
    child: {
      esModuleURI: "chrome://cthulhu/content/newtab/CthulhuFilePickerChild.sys.mjs",
      // wantUntrusted so we also catch script-driven input.click() (how many
      // sites, e.g. a custom "Upload" button, open the file dialog).
      events: { click: { capture: true, wantUntrusted: true } },
    },
    allFrames: true,
  });
} catch (e) {
  if (!/already/i.test(String(e))) {
    console.error("[Cthulhu] file picker actor registration:", e);
  }
}
