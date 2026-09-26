/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Registers the tab-audio actor pair exactly once per process. ES modules are
 * singletons, so importing this from every browser window's tab-audio.js is
 * safe; registerWindowActor throws on the second call and that is the only
 * "already done" signal there is, so it is caught and ignored (the same shape
 * NowPlayingWidget.sys.mjs uses for its actor).
 *
 * DOMDocElementInserted, because the child has to wrap getDisplayMedia before
 * the page's own scripts run and this is the earliest event an actor actually
 * receives (DOMWindowCreated fires before the actor has listeners at all, so
 * nothing arrives -- measured, and no actor in the tree uses it either).
 * allFrames is false: only a top-level document can screen-share, and only a
 * top-level document is a thing the picker can offer. */

try {
  ChromeUtils.registerWindowActor("CthulhuTabAudio", {
    parent: {
      esModuleURI: "chrome://cthulhu/content/modules/tab-audio/CthulhuTabAudioParent.sys.mjs",
    },
    child: {
      esModuleURI: "chrome://cthulhu/content/modules/tab-audio/CthulhuTabAudioChild.sys.mjs",
      events: { DOMDocElementInserted: { capture: true } },
    },
    messageManagerGroups: ["browsers"],
    allFrames: false,
  });
} catch (e) {
  if (!/already/i.test(String(e))) {
    console.error("[Cthulhu:tab-audio] actor registration failed:", e);
  }
}
