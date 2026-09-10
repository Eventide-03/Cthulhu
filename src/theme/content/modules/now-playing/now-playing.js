/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Now Playing: a toolbar squircle (left of the extensions button) showing
 * whatever media is playing in any tab, and a dropdown player under it --
 * title, artist, a seekable progress bar with elapsed / total time, and
 * previous / play-pause / next / mute. Nothing else: no service toggles, no
 * embedded web apps, no browse shortcuts, no search. (Those were the former
 * side-panels module; this is what is left once they went.)
 *
 * Two pieces, set up per window from __cthulhuBuildNowPlayingItem (called by
 * NowPlayingWidget.sys.mjs's onBuild, once per browser window):
 *   - createMediaTracker()  -- one "what's playing right now" poll per window,
 *                              fanned out to both UIs
 *   - createPlayerDropdown() / setupNowPlaying() -- the popup and the squircle
 *
 * Transport controls call straight into the tab's MediaController (play /
 * pause / prevTrack / nextTrack / seekTo -- MediaController.webidl). There is
 * no volume-LEVEL API on that interface at all, so the speaker button toggles
 * the tab's own mute flag rather than pretending to be a slider it cannot be.
 *
 * ART SLOTS: assets/prev.png, play.png, pause.png, next.png, volume.png,
 * mute.png, close.png -- each 16x16, drawn 1:1 (rendered at 16 CSS px,
 * pixelated). Overwrite in place.
 *
 * Runs in the browser-window scope (see loader.js). CustomizableUI's ES module
 * import is cached by the module loader, so importing it from every window's
 * copy of this script is cheap, not a fresh load.
 * ============================================================================= */
(function () {
  "use strict";
  const ID = "now-playing";
  const ASSET = "chrome://cthulhu/content/modules/now-playing/assets/";

  /* ---------------------------------------------------------------------
   * Shared media tracking: aggregates each tab's chrome-only
   * browsingContext.mediaController (title/artist/position via events --
   * see MediaController.webidl) into one readout. There is no built-in
   * "any tab" event for this (the closest, "main-media-controller-changed",
   * is gated behind a testing-only pref), so this polls every tab's
   * controller flags on a short interval and picks the best candidate --
   * a handful of boolean reads, cheap.
   * --------------------------------------------------------------------- */
  function pickMainMedia(win) {
    let best = null;
    let bestScore = -1;
    for (const tab of win.gBrowser.tabs) {
      const mc = tab.linkedBrowser?.browsingContext?.mediaController;
      if (!mc || !mc.isActive) continue;
      const score = (mc.isPlaying ? 2 : 0) + (mc.isAudible ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { tab, mc };
      }
    }
    return best;
  }

  function createMediaTracker(win) {
    let current = null; // { tab, mc }
    let posSnap = null; // { position, duration, rate, at } -- last positionstatechange, extrapolated between events
    const listeners = new Set();

    function notify() {
      for (const fn of listeners) {
        try { fn(); } catch (e) { console.error("[Cthulhu:" + ID + "] tracker listener", e); }
      }
    }
    function onPositionState(e) {
      posSnap = { position: e.position, duration: e.duration, rate: e.playbackRate, at: win.performance.now() };
      notify();
    }
    function attachTo(pick) {
      if (current) {
        current.mc.removeEventListener("metadatachange", notify);
        current.mc.removeEventListener("playbackstatechange", notify);
        current.mc.removeEventListener("positionstatechange", onPositionState);
      }
      current = pick;
      posSnap = null;
      if (current) {
        current.mc.addEventListener("metadatachange", notify);
        current.mc.addEventListener("playbackstatechange", notify);
        current.mc.addEventListener("positionstatechange", onPositionState);
      }
      notify();
    }
    function tick() {
      const pick = pickMainMedia(win);
      if (pick?.tab !== current?.tab) attachTo(pick);
      else notify(); // re-extrapolate the progress bar between position events
    }

    const iv = win.setInterval(tick, 250);
    tick();
    win.addEventListener("unload", () => win.clearInterval(iv));

    return {
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      get current() { return current; },
      get duration() { return posSnap ? posSnap.duration : 0; },
      extrapolatedPosition() {
        if (!posSnap || !(posSnap.duration > 0)) return null;
        let pos = posSnap.position;
        if (current && current.mc.isPlaying) {
          pos += ((win.performance.now() - posSnap.at) / 1000) * (posSnap.rate || 1);
        }
        return Math.max(0, Math.min(pos, posSnap.duration));
      },
      seek(fraction) {
        if (current && posSnap && posSnap.duration > 0) current.mc.seekTo(fraction * posSnap.duration);
      },
    };
  }

  function metadataOf(current) {
    let meta = null;
    try { meta = current.mc.getMetadata(); } catch (e) {} // throws if the controller went inactive between the poll and here
    return {
      title: (meta && meta.title) || current.tab.label || "",
      artist: (meta && meta.artist) || "",
    };
  }

  /** 75 -> "1:15"; 3725 -> "1:02:05". */
  function fmtTime(sec) {
    if (!(sec >= 0) || !isFinite(sec)) return "0:00";
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const two = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + two(m) + ":" + two(s) : m + ":" + two(s);
  }

  /* ------------------------------ the squircle ----------------------------- */
  function setupNowPlaying(win, els, tracker, onSquircleClick) {
    const { squircle, title, artist, fill } = els;
    function render() {
      const current = tracker.current;
      if (!current) {
        squircle.classList.remove("playing");
        title.textContent = "Nothing playing";
        artist.textContent = "";
        fill.style.width = "0%";
        return;
      }
      squircle.classList.toggle("playing", current.mc.isPlaying);
      const m = metadataOf(current);
      title.textContent = m.title;
      artist.textContent = m.artist;
      const pos = tracker.extrapolatedPosition();
      if (pos != null && tracker.duration > 0) {
        fill.style.width = (pos / tracker.duration) * 100 + "%";
      } else {
        fill.style.width = current.mc.isPlaying ? "100%" : "0%"; // no duration reported -- e.g. a live stream
      }
    }
    tracker.subscribe(render);
    render();
    squircle.addEventListener("click", () => onSquircleClick());
  }

  /* ---------------------------------------------------------------------
   * Dropdown player: a real XUL <panel type="arrow"> anchored to the
   * squircle. Real popups render in the OS-level popup layer, above every
   * other piece of chrome.
   *
   *   [ Title                          × ]
   *   [ Artist                           ]
   *   [ 0:15 ━━━━━━━━━━━━━━━━━━━━ 3:53   ]
   *   [      |<    ||    >|    🔊        ]
   * --------------------------------------------------------------------- */
  function createPlayerDropdown(win, tracker) {
    const doc = win.document;
    const popupset = doc.getElementById("mainPopupSet") || doc.documentElement;

    const panel = doc.createXULElement("panel");
    panel.id = "cthulhu-player-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("flip", "both");
    // panel-no-padding: the card supplies its own padding -- without this the
    // default arrow-panel content padding (toolkit's popup.css) stacks with it.
    panel.className = "cthulhu-player-popup panel-no-padding";
    popupset.appendChild(panel);

    const card = doc.createElement("div");
    card.className = "cthulhu-player-card";
    panel.appendChild(card);

    const icon = (name) => {
      const img = doc.createElement("img");
      img.className = "cthulhu-player-icon";
      img.src = ASSET + name + ".png";
      img.alt = "";
      img.draggable = false;
      return img;
    };

    // Header: title + artist on the left (click either to go to the tab),
    // close on the right.
    const head = doc.createElement("div");
    head.className = "cthulhu-player-head";
    const info = doc.createElement("button");
    info.type = "button";
    info.className = "cthulhu-player-info";
    info.title = "Go to the tab that is playing";
    const titleEl = doc.createElement("div");
    titleEl.className = "cthulhu-player-title";
    const artistEl = doc.createElement("div");
    artistEl.className = "cthulhu-player-artist";
    info.append(titleEl, artistEl);
    info.addEventListener("click", () => {
      const tab = tracker.current?.tab;
      if (!tab) return;
      panel.hidePopup();
      win.gBrowser.selectedTab = tab;
    });
    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cthulhu-player-close";
    closeBtn.title = "Close";
    closeBtn.appendChild(icon("close"));
    closeBtn.addEventListener("click", () => panel.hidePopup());
    head.append(info, closeBtn);

    // Progress with the elapsed time on the left and the total on the right.
    const progressRow = doc.createElement("div");
    progressRow.className = "cthulhu-player-progress-row";
    const elapsed = doc.createElement("span");
    elapsed.className = "cthulhu-player-time";
    elapsed.textContent = "0:00";
    const progress = doc.createElement("div");
    progress.className = "cthulhu-player-progress";
    const progressFill = doc.createElement("div");
    progressFill.className = "cthulhu-player-progress-fill";
    progress.appendChild(progressFill);
    const total = doc.createElement("span");
    total.className = "cthulhu-player-time";
    total.textContent = "0:00";
    progressRow.append(elapsed, progress, total);

    function seekAt(clientX) {
      const r = progress.getBoundingClientRect();
      if (!r.width) return;
      const frac = Math.max(0, Math.min(1, (clientX - r.x) / r.width));
      tracker.seek(frac);
    }
    progress.addEventListener("pointerdown", (e) => {
      seekAt(e.clientX);
      try { progress.setPointerCapture(e.pointerId); } catch (err) {}
    });
    progress.addEventListener("pointermove", (e) => {
      if (e.buttons & 1) seekAt(e.clientX);
    });

    // Transport. Each button holds a 16x16 icon slot; play/pause swap theirs.
    const controls = doc.createElement("div");
    controls.className = "cthulhu-player-controls";
    const mk = (cls, title, iconName) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "cthulhu-player-ctrl " + cls;
      b.title = title;
      b.appendChild(icon(iconName));
      return b;
    };
    const prevBtn = mk("prev", "Previous", "prev");
    const playBtn = mk("play", "Play/Pause", "play");
    const nextBtn = mk("next", "Next", "next");
    const muteBtn = mk("mute", "Mute", "volume");
    controls.append(prevBtn, playBtn, nextBtn, muteBtn);

    prevBtn.addEventListener("click", () => tracker.current?.mc.prevTrack());
    nextBtn.addEventListener("click", () => tracker.current?.mc.nextTrack());
    playBtn.addEventListener("click", () => {
      const mc = tracker.current?.mc;
      if (!mc) return;
      if (mc.isPlaying) mc.pause(); else mc.play();
    });
    muteBtn.addEventListener("click", () => {
      const tab = tracker.current?.tab;
      if (!tab) return;
      tab.linkedBrowser.audioMuted = !tab.linkedBrowser.audioMuted;
      render();
    });

    card.append(head, progressRow, controls);

    const setIcon = (btn, name) => {
      const img = btn.querySelector("img");
      const want = ASSET + name + ".png";
      if (img && img.getAttribute("src") !== want) img.src = want;
    };

    function render() {
      const current = tracker.current;
      if (!current) {
        titleEl.textContent = "Nothing playing";
        artistEl.textContent = "";
        info.disabled = true;
        progressFill.style.width = "0%";
        elapsed.textContent = "0:00";
        total.textContent = "0:00";
        setIcon(playBtn, "play");
        playBtn.disabled = true;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        muteBtn.disabled = true;
        return;
      }
      const m = metadataOf(current);
      titleEl.textContent = m.title;
      artistEl.textContent = m.artist;
      info.disabled = false;
      playBtn.disabled = false;
      setIcon(playBtn, current.mc.isPlaying ? "pause" : "play");
      const supported = current.mc.supportedKeys || [];
      prevBtn.disabled = !supported.includes("previoustrack");
      nextBtn.disabled = !supported.includes("nexttrack");
      muteBtn.disabled = false;
      const muted = !!current.tab.linkedBrowser.audioMuted;
      setIcon(muteBtn, muted ? "mute" : "volume");
      muteBtn.classList.toggle("muted", muted);
      muteBtn.title = muted ? "Unmute" : "Mute";
      const pos = tracker.extrapolatedPosition();
      if (pos != null && tracker.duration > 0) {
        progressFill.style.width = (pos / tracker.duration) * 100 + "%";
        elapsed.textContent = fmtTime(pos);
        total.textContent = fmtTime(tracker.duration);
      } else {
        progressFill.style.width = current.mc.isPlaying ? "100%" : "0%";
        elapsed.textContent = current.mc.isPlaying ? "live" : "0:00";
        total.textContent = "";
      }
    }

    let unsub = null;
    let tickIv = null;
    panel.addEventListener("popupshown", () => {
      unsub = tracker.subscribe(render);
      render();
      tickIv = win.setInterval(render, 250); // re-extrapolates the progress bar while visible
    });
    panel.addEventListener("popuphiding", () => {
      if (unsub) { unsub(); unsub = null; }
      if (tickIv) { win.clearInterval(tickIv); tickIv = null; }
    });

    return {
      toggle(anchor) {
        if (panel.state === "open" || panel.state === "showing") {
          panel.hidePopup();
        } else {
          panel.openPopup(anchor, { position: "bottomcenter topcenter" });
        }
      },
    };
  }

  /* --- toolbar widget: build the DOM for THIS window (called by
   * NowPlayingWidget.sys.mjs's onBuild -- see that file for why the
   * CustomizableUI.createWidget() call lives there and not here). */
  window.__cthulhuBuildNowPlayingItem = function (doc) {
    const win = doc.defaultView;
    const item = doc.createXULElement("toolbaritem");
    item.id = "cthulhu-nowplaying";
    item.classList.add("chromeclass-toolbar-additional", "cthulhu-nowplaying-item");

    const squircle = doc.createElement("div");
    squircle.className = "cthulhu-np-squircle";
    squircle.title = "Now Playing";

    const info = doc.createElement("div");
    info.className = "cthulhu-np-info";
    const title = doc.createElement("div");
    title.className = "cthulhu-np-title";
    title.textContent = "Nothing playing";
    const artistEl = doc.createElement("div");
    artistEl.className = "cthulhu-np-artist";
    info.append(title, artistEl);

    const track = doc.createElement("div");
    track.className = "cthulhu-np-track";
    const fill = doc.createElement("div");
    fill.className = "cthulhu-np-fill";
    track.appendChild(fill);

    squircle.append(info, track);
    item.append(squircle);

    const tracker = createMediaTracker(win);
    const dropdown = createPlayerDropdown(win, tracker);
    setupNowPlaying(win, { squircle, title, artist: artistEl, fill }, tracker, () => dropdown.toggle(squircle));

    // Placing this "immediately before the extensions button" via
    // CustomizableUI's placement-array index is a race at startup: at the
    // moment this module runs, the extensions button isn't reliably in the
    // navbar's placements array yet (confirmed live: indexOf came back -1,
    // so the position argument silently fell back to "append at the end" and
    // the widget landed AFTER it instead of before). A plain DOM move after
    // insertion sidesteps that race entirely.
    win.setTimeout(() => {
      const ext = doc.getElementById("unified-extensions-button");
      if (ext?.parentNode && ext.previousElementSibling !== item) {
        ext.parentNode.insertBefore(item, ext);
      }
    }, 0);

    return item;
  };

  try {
    ChromeUtils.importESModule("chrome://cthulhu/content/modules/now-playing/NowPlayingWidget.sys.mjs");
  } catch (e) {
    console.error("[Cthulhu:" + ID + "] widget registration failed:", e);
  }
})();
