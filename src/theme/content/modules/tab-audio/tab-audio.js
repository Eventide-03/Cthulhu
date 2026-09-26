/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Share a tab's audio with a screen share -- what Chromium calls "share tab
 * audio", which Firefox has never had.
 *
 * Firefox's getDisplayMedia ignores the audio constraint outright, so a call in
 * a Firefox tab is always silent: you can share the video of a film and nobody
 * hears it. This module fills that in without touching the engine. The actor
 * pair does the work (CthulhuTabAudioChild explains how, and why it goes
 * through a loopback peer connection); this file is the part that needs a
 * browser window -- the picker that asks WHICH tab, and the registration call
 * that brings the actors up.
 *
 * The picker is deliberately a separate, explicit step after Firefox's own
 * share dialog. Handing a web page the audio of a DIFFERENT tab is a real
 * privilege -- more than the screen share it rides along with, because the
 * page never sees that tab otherwise -- so it is never inferred, never
 * remembered, and never defaulted to "yes". The user names the tab, every
 * time, and can say no and still get their (silent) screen share.
 * ========================================================================== */
(function () {
  const PREF_ENABLED = "cthulhu.tabaudio.enabled";

  if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
    return;
  }

  /* Bring up the actor pair (once per process, not once per window). */
  ChromeUtils.importESModule("chrome://cthulhu/content/modules/tab-audio/TabAudioShare.sys.mjs");

  const doc = document;

  /* A tab is worth offering if it is a real web page other than the one asking.
   * about: pages, the Home tab and the requester itself are dropped: sharing
   * the sharing tab's own audio is a feedback loop, and a chrome page has
   * nothing anyone wants to hear. */
  function candidates(requester) {
    const out = [];
    for (const tab of gBrowser.tabs) {
      const b = tab.linkedBrowser;
      if (!b || b === requester || tab.closing) {
        continue;
      }
      const uri = b.currentURI;
      if (!uri || !/^(https?|file)$/.test(uri.scheme)) {
        continue;
      }
      out.push(tab);
    }
    return out;
  }

  function faviconFor(tab) {
    try {
      return tab.image || tab.linkedBrowser.mIconURL || "";
    } catch (e) {
      return "";
    }
  }

  /* Ask the tab's own actor whether anything is actually making noise.
   * tab.soundPlaying alone is not enough: it misses a page playing through Web
   * Audio, which has no media element to flag. Best-effort -- a tab that does
   * not answer is simply not marked, never hidden. */
  async function audible(tab) {
    if (tab.soundPlaying) {
      return true;
    }
    try {
      const wg = tab.linkedBrowser.browsingContext.currentWindowGlobal;
      return !!(await wg.getActor("CthulhuTabAudio").sendQuery("TabAudio:IsAudible", {}));
    } catch (e) {
      return false;
    }
  }

  let openPicker = null;

  /** Ask which tab's audio to share. -> the chosen tab, or null. */
  function pick(opts) {
    const requester = (opts && opts.requester) || null;
    // One at a time. A second share starting while the first is still asking
    // would leave two panels fighting over the same anchor.
    if (openPicker) {
      openPicker();
    }
    const tabs = candidates(requester);

    return new Promise((resolve) => {
      const panel = doc.createXULElement("panel");
      panel.id = "cthulhu-tabaudio-picker";
      panel.className = "cthulhu-tabaudio-panel panel-no-padding";
      panel.setAttribute("type", "arrow");
      panel.setAttribute("flip", "both");
      panel.setAttribute("noautofocus", "false");

      let done = false;
      const finish = (tab) => {
        if (done) {
          return;
        }
        done = true;
        openPicker = null;
        resolve(tab || null);
        try { panel.hidePopup(); } catch (e) {}
      };
      openPicker = () => finish(null);

      const card = doc.createElement("div");
      card.className = "cthulhu-tabaudio-card";

      const title = doc.createElement("div");
      title.className = "cthulhu-tabaudio-title";
      title.textContent = "Share a tab's audio?";
      card.appendChild(title);

      const sub = doc.createElement("div");
      sub.className = "cthulhu-tabaudio-sub";
      sub.textContent = tabs.length
        ? "Everything the tab you pick is playing goes into the call. You still hear it too."
        : "No other tab is open to share audio from.";
      card.appendChild(sub);

      const list = doc.createElement("div");
      list.className = "cthulhu-tabaudio-list";
      card.appendChild(list);

      const rows = [];
      for (const tab of tabs) {
        const row = doc.createElement("button");
        row.className = "cthulhu-tabaudio-row";
        const img = doc.createElement("img");
        img.className = "cthulhu-tabaudio-fav";
        img.src = faviconFor(tab);
        img.alt = "";
        const label = doc.createElement("span");
        label.className = "cthulhu-tabaudio-label";
        label.textContent = tab.label || (tab.linkedBrowser.currentURI && tab.linkedBrowser.currentURI.host) || "Tab";
        const mark = doc.createElement("span");
        mark.className = "cthulhu-tabaudio-mark";
        row.append(img, label, mark);
        row.addEventListener("command", () => finish(tab));
        row.addEventListener("click", () => finish(tab));
        list.appendChild(row);
        rows.push({ tab, row, mark });
      }

      // Mark what is actually making noise, and put those first -- the tab you
      // want is nearly always one of them. Async, so the panel is never held
      // shut waiting on a tab that is busy.
      Promise.all(rows.map((r) => audible(r.tab).then((a) => ({ ...r, a })))).then((marked) => {
        if (done) {
          return;
        }
        for (const r of marked) {
          if (r.a) {
            r.row.classList.add("playing");
            r.mark.textContent = "playing";
            list.insertBefore(r.row, list.firstChild);
          }
        }
      });

      const no = doc.createElement("button");
      no.className = "cthulhu-tabaudio-decline";
      no.textContent = tabs.length ? "Share without audio" : "Continue";
      no.addEventListener("click", () => finish(null));
      card.appendChild(no);

      panel.appendChild(card);
      panel.addEventListener("popuphidden", () => {
        finish(null);
        panel.remove();
      });
      panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          finish(null);
        }
      });

      doc.getElementById("mainPopupSet").appendChild(panel);
      // Anchored to the sharing tab's own content area, so it is obvious which
      // share it belongs to when several windows are open.
      const anchor = requester || gBrowser.selectedBrowser;
      try {
        panel.openPopup(anchor, "topcenter bottomleft", 0, 8, false, false);
      } catch (e) {
        panel.openPopupAtScreen(100, 100, false);
      }
    });
  }

  window.CthulhuTabAudio = { pick };
})();
