/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Now Playing: a toolbar squircle (left of the extensions button) showing
 * whatever media is playing in any tab, and a player card -- title, artist, a
 * seekable progress bar with elapsed / total time, previous / play-pause /
 * next, and a speaker that mutes on click and shows a volume slider on hover.
 * The card appears in two places: a dropdown under the squircle, and DOCKED at
 * the bottom of the sidebar while compact mode is on (modules/compact-mode
 * asks for it through window.CthulhuNowPlaying.dock()).
 *
 * NO FLICKER, BY CONSTRUCTION. The first version re-rendered everything four
 * times a second from a poll that "notified" whether or not anything changed,
 * and the progress bar was fed extrapolated positions that Google's position
 * events kept correcting backwards by a few hundred ms -- the bar and the
 * elapsed label wobbled. Now:
 *   - the tracker notifies only on a real change (a different tab, or a
 *     metadata / playback / position event from the controller);
 *   - the cards run their own 1 Hz clock for the progress bar while something
 *     plays, with a 1 s linear transition so the bar glides instead of steps;
 *   - a displayed position never moves backwards by less than a couple of
 *     seconds (that is jitter, not a seek);
 *   - nothing in the DOM is written unless its value changed.
 *
 * MUTE uses the tab's own toggleMuteAudio(): the browser element's audioMuted
 * is getter-only, and assigning it (what the old code did) throws in strict
 * mode -- which is why the button did nothing.
 *
 * VOLUME: there is no per-tab volume level anywhere in Gecko's chrome API (no
 * nsIDOMWindowUtils.audioVolume in this tree, nothing on MediaController or
 * BrowsingContext). The slider therefore sets `volume` on the page's <audio>
 * and <video> elements through a content actor (CthulhuTabVolume*, registered
 * from NowPlayingWidget.sys.mjs), including elements the page creates later
 * and every frame of the tab. Honest limits: a page with its own volume
 * control can set the element's volume again afterwards, and a Web Audio
 * player (no media element) is untouched.
 *
 * ART SLOTS (assets/): play, pause, skip (previous is skip mirrored), sound1 /
 * sound2 / sound3 (the speaker at three levels), mute, close. Each is drawn at
 * whatever size it was drawn and shown 1:1, pixelated -- nothing is scaled to
 * a fixed box. Overwrite in place.
 *
 * Runs in the browser-window scope (see loader.js).
 * ============================================================================= */
(function () {
  "use strict";
  const ID = "now-playing";
  const ASSET = "chrome://cthulhu/content/modules/now-playing/assets/";
  const PROGRESS_TICK_MS = 1000;
  /* The speaker's art for a volume level. Going by the drawings, sound1 is the
   * full three-arc speaker and sound3 the one-arc one, so loud is sound1.
   * Thirds of the range; 0 (or muted) is the mute art. */
  const speakerIcon = (level) =>
    level <= 0 ? "mute" : level > 2 / 3 ? "sound1" : level > 1 / 3 ? "sound2" : "sound3";
  const JITTER_S = 2; // a backwards move smaller than this is noise, not a seek

  const win = window;

  /* ---------------------------------------------------------------------
   * Shared media tracking: aggregates each tab's chrome-only
   * browsingContext.mediaController (title/artist/position via events --
   * see MediaController.webidl) into one readout. There is no built-in
   * "any tab" event for this, so the candidate is re-picked on a short poll
   * (a handful of boolean reads); listeners hear about it only when the
   * pick, its metadata, its playback state or its position CHANGES.
   * --------------------------------------------------------------------- */
  function pickMainMedia() {
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

  function createMediaTracker() {
    let current = null; // { tab, mc }
    let posSnap = null; // { position, duration, rate, at } -- last positionstatechange, extrapolated between events
    let shown = { tab: null, pos: 0 }; // last position handed out, for the jitter guard
    const listeners = new Set();

    function notify() {
      for (const fn of listeners) {
        try { fn(); } catch (e) { console.error("[Cthulhu:" + ID + "] tracker listener", e); }
      }
    }
    function onPositionState(e) {
      const before = posSnap;
      posSnap = { position: e.position, duration: e.duration, rate: e.playbackRate, at: win.performance.now() };
      // A real seek (or a new track) must be allowed to move the bar back.
      if (!before || Math.abs(e.position - before.position) > JITTER_S) shown = { tab: current && current.tab, pos: 0 };
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
      shown = { tab: pick && pick.tab, pos: 0 };
      if (current) {
        current.mc.addEventListener("metadatachange", notify);
        current.mc.addEventListener("playbackstatechange", notify);
        current.mc.addEventListener("positionstatechange", onPositionState);
      }
      notify();
    }
    function tick() {
      const pick = pickMainMedia();
      if (pick?.tab !== current?.tab) attachTo(pick);
    }

    const iv = win.setInterval(tick, 500);
    tick();
    win.addEventListener("unload", () => win.clearInterval(iv));

    return {
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      get current() { return current; },
      get duration() { return posSnap ? posSnap.duration : 0; },
      get isPlaying() { return !!(current && current.mc.isPlaying); },
      extrapolatedPosition() {
        if (!posSnap || !(posSnap.duration > 0)) return null;
        let pos = posSnap.position;
        if (current && current.mc.isPlaying) {
          pos += ((win.performance.now() - posSnap.at) / 1000) * (posSnap.rate || 1);
        }
        pos = Math.max(0, Math.min(pos, posSnap.duration));
        // Jitter guard: an extrapolated value that a late position event pulls
        // back by a fraction of a second must not make the bar twitch.
        if (current && shown.tab === current.tab && pos < shown.pos && shown.pos - pos < JITTER_S) pos = shown.pos;
        shown = { tab: current && current.tab, pos };
        return pos;
      },
      seek(fraction) {
        if (current && posSnap && posSnap.duration > 0) {
          shown = { tab: current.tab, pos: 0 };
          current.mc.seekTo(fraction * posSnap.duration);
        }
      },
      metadata() {
        if (!current) return { title: "", artist: "" };
        let meta = null;
        try { meta = current.mc.getMetadata(); } catch (e) {} // throws if the controller went inactive between the poll and here
        return {
          title: (meta && meta.title) || current.tab.label || "",
          artist: (meta && meta.artist) || "",
        };
      },
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
  /* Write only when different: a text node replaced with an identical one is
   * still a relayout of that line, and the old code did it four times a second. */
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const setDisabled = (el, v) => { if (el.disabled !== v) el.disabled = v; };
  const setVar = (el, name, v) => { if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };
  /* Bar widths are percentages; a move under 0.4 of a point is invisible on a
   * 250px bar, so it is not written -- a four-minute track's 4 Hz position
   * events then settle to about one write a second, the clock's. */
  const setWidth = (el, v, force) => {
    if (el.style.width === v) return;
    if (!force) {
      const cur = parseFloat(el.style.width), next = parseFloat(v);
      if (!isNaN(cur) && !isNaN(next) && Math.abs(next - cur) < 0.4) return;
    }
    el.style.width = v;
  };

  /* --------------------------- tab volume (actor) -------------------------- */
  // The levels live in the parent actor's module (keyed by browserId), where a
  // freshly loaded frame's "what does my tab want?" can find them; the tab
  // element keeps a copy for the UI.
  let TabVolumes = null;
  try {
    ({ TabVolumes } = ChromeUtils.importESModule("chrome://cthulhu/content/modules/now-playing/CthulhuTabVolumeParent.sys.mjs"));
  } catch (e) {
    console.error("[Cthulhu:" + ID + "] tab-volume registry:", e);
  }
  const volume = {
    get(tab) {
      const v = tab && tab._cthulhuVolume;
      return typeof v === "number" ? v : 1;
    },
    set(tab, v) {
      if (!tab) return;
      v = Math.max(0, Math.min(1, Number(v) || 0));
      tab._cthulhuVolume = v;
      const bid = tab.linkedBrowser?.browserId;
      if (TabVolumes && bid) {
        if (v < 1) TabVolumes.set(bid, v); else TabVolumes.delete(bid);
      }
      const top = tab.linkedBrowser?.browsingContext;
      if (!top) return;
      let contexts = [];
      try { contexts = top.getAllBrowsingContextsInSubtree(); } catch (e) { contexts = [top]; }
      for (const bc of contexts) {
        try {
          bc.currentWindowGlobal?.getActor("CthulhuTabVolume")?.sendAsyncMessage("CthulhuTabVolume:Set", { volume: v });
        } catch (e) { /* a frame with no actor yet; it asks on load */ }
      }
    },
  };
  // A closed tab's entry is not needed any more.
  win.addEventListener("load", () => {
    win.gBrowser?.tabContainer.addEventListener("TabClose", (e) => {
      const bid = e.target.linkedBrowser?.browserId;
      if (TabVolumes && bid) TabVolumes.delete(bid);
    });
  }, { once: true });

  /* ------------------------------ the squircle ----------------------------- */
  function setupNowPlaying(els, tracker, onSquircleClick) {
    const { squircle, title, artist, fill } = els;
    let clock = 0;
    function progress() {
      const current = tracker.current;
      if (!current) { setWidth(fill, "0%"); return; }
      const pos = tracker.extrapolatedPosition();
      if (pos != null && tracker.duration > 0) setWidth(fill, (pos / tracker.duration) * 100 + "%");
      else setWidth(fill, current.mc.isPlaying ? "100%" : "0%"); // no duration reported -- e.g. a live stream
    }
    function render() {
      const current = tracker.current;
      if (!current) {
        squircle.classList.remove("playing");
        setText(title, "Nothing playing");
        setText(artist, "");
      } else {
        squircle.classList.toggle("playing", current.mc.isPlaying);
        const m = tracker.metadata();
        setText(title, m.title);
        setText(artist, m.artist);
      }
      progress();
      // The 1 Hz clock runs only while something plays.
      if (tracker.isPlaying && !clock) clock = win.setInterval(progress, PROGRESS_TICK_MS);
      if (!tracker.isPlaying && clock) { win.clearInterval(clock); clock = 0; }
    }
    tracker.subscribe(render);
    render();
    win.addEventListener("unload", () => { if (clock) win.clearInterval(clock); });
    squircle.addEventListener("click", () => onSquircleClick());
  }

  /* ---------------------------------------------------------------------
   * The player card. Built once per host (dropdown panel, or the docked
   * slot in compact mode); attach() starts rendering, detach() stops it.
   *
   *   [ Title                          × ]      (× only in the dropdown)
   *   [ Artist                           ]
   *   [ 0:15 ━━━━━━━━━━━━━━━━━━━━ 3:53   ]
   *   [      |<    ||    >|    🔊 ━━━━   ]      (slider slides out on hover)
   * --------------------------------------------------------------------- */
  function buildPlayerCard(doc, tracker, opts) {
    const card = doc.createElement("div");
    card.className = "cthulhu-player-card" + (opts && opts.docked ? " docked" : "");

    const icon = (name, cls) => {
      const img = doc.createElement("img");
      img.className = "cthulhu-player-icon" + (cls ? " " + cls : "");
      img.src = ASSET + name + ".png";
      img.alt = "";
      img.draggable = false;
      return img;
    };
    const setIcon = (btn, name) => {
      const img = btn.querySelector("img");
      const want = ASSET + name + ".png";
      if (img && img.getAttribute("src") !== want) img.src = want;
    };

    // Header: title + artist on the left (click either to go to the tab),
    // close on the right (dropdown only).
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
      if (opts && opts.onClose) opts.onClose();
      win.gBrowser.selectedTab = tab;
    });
    head.appendChild(info);
    if (opts && opts.onClose) {
      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "cthulhu-player-close";
      closeBtn.title = "Close";
      closeBtn.appendChild(icon("close"));
      closeBtn.addEventListener("click", () => opts.onClose());
      head.appendChild(closeBtn);
    }

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
      // Show the seek at once rather than after the next tick.
      progressFill.classList.add("jump");
      setWidth(progressFill, frac * 100 + "%", true);
      win.setTimeout(() => progressFill.classList.remove("jump"), 50);
    }
    progress.addEventListener("pointerdown", (e) => {
      seekAt(e.clientX);
      try { progress.setPointerCapture(e.pointerId); } catch (err) {}
    });
    progress.addEventListener("pointermove", (e) => {
      if (e.buttons & 1) seekAt(e.clientX);
    });

    // Transport. Each button holds one icon slot; play/pause swap theirs, the
    // speaker shows the level (speakerIcon), and previous is skip mirrored.
    const controls = doc.createElement("div");
    controls.className = "cthulhu-player-controls";
    const mk = (cls, title, iconName, iconCls) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "cthulhu-player-ctrl " + cls;
      b.title = title;
      b.appendChild(icon(iconName, iconCls));
      return b;
    };
    const prevBtn = mk("prev", "Previous", "skip", "flip");
    const playBtn = mk("play", "Play/Pause", "play");
    const nextBtn = mk("next", "Next", "skip");
    const muteBtn = mk("mute", "Mute", speakerIcon(1));

    // Speaker + slider. The slider is collapsed to nothing and slides out
    // while the pointer is over the group (see .cthulhu-player-vol in CSS).
    const vol = doc.createElement("div");
    vol.className = "cthulhu-player-vol";
    const slider = doc.createElement("input");
    slider.type = "range";
    slider.className = "cthulhu-player-slider";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = "100";
    slider.title = "Volume";
    slider.setAttribute("aria-label", "Volume");
    vol.append(muteBtn, slider);
    controls.append(prevBtn, playBtn, nextBtn, vol);

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
      tab.toggleMuteAudio(); // NOT browser.audioMuted = ...: that is getter-only
      render();
    });
    slider.addEventListener("input", () => {
      const tab = tracker.current?.tab;
      if (!tab) return;
      volume.set(tab, Number(slider.value) / 100);
      // Sliding up from silence un-mutes, as every player does.
      if (Number(slider.value) > 0 && tab.linkedBrowser.audioMuted) tab.toggleMuteAudio();
      paintVolume(tab);
    });

    card.append(head, progressRow, controls);

    function paintVolume(tab) {
      const muted = !!(tab && tab.linkedBrowser.audioMuted);
      const level = tab ? volume.get(tab) : 1;
      setIcon(muteBtn, speakerIcon(muted ? 0 : level));
      muteBtn.classList.toggle("muted", muted);
      const t = muted ? "Unmute" : "Mute";
      if (muteBtn.title !== t) muteBtn.title = t;
      const want = String(Math.round(level * 100));
      if (slider.value !== want && doc.activeElement !== slider) slider.value = want;
      setVar(vol, "--cthulhu-vol", (muted ? 0 : Math.round(level * 100)) + "%");
    }
    function progressPaint() {
      const current = tracker.current;
      if (!current) return;
      const pos = tracker.extrapolatedPosition();
      if (pos != null && tracker.duration > 0) {
        setWidth(progressFill, (pos / tracker.duration) * 100 + "%");
        setText(elapsed, fmtTime(pos));
        setText(total, fmtTime(tracker.duration));
      } else {
        setWidth(progressFill, current.mc.isPlaying ? "100%" : "0%");
        setText(elapsed, current.mc.isPlaying ? "live" : "0:00");
        setText(total, "");
      }
    }
    function render() {
      const current = tracker.current;
      if (!current) {
        setText(titleEl, "Nothing playing");
        setText(artistEl, "");
        setDisabled(info, true);
        setWidth(progressFill, "0%", true);
        setText(elapsed, "0:00");
        setText(total, "0:00");
        setIcon(playBtn, "play");
        setDisabled(playBtn, true);
        setDisabled(prevBtn, true);
        setDisabled(nextBtn, true);
        setDisabled(muteBtn, true);
        setDisabled(slider, true);
        card.classList.remove("playing");
        return;
      }
      const m = tracker.metadata();
      setText(titleEl, m.title);
      setText(artistEl, m.artist);
      setDisabled(info, false);
      setDisabled(playBtn, false);
      setIcon(playBtn, current.mc.isPlaying ? "pause" : "play");
      card.classList.toggle("playing", current.mc.isPlaying);
      const supported = current.mc.supportedKeys || [];
      setDisabled(prevBtn, !supported.includes("previoustrack"));
      setDisabled(nextBtn, !supported.includes("nexttrack"));
      setDisabled(muteBtn, false);
      setDisabled(slider, false);
      paintVolume(current.tab);
      progressPaint();
    }

    let unsub = null;
    let clock = 0;
    // The tab's mute state can change from its own tab strip button; keep the
    // speaker honest without polling: TabAttrModified fires for "muted".
    const onTabAttr = (e) => {
      if (e.target === tracker.current?.tab && e.detail?.changed?.includes("muted")) render();
    };
    return {
      card,
      render,
      attach() {
        if (unsub) return;
        unsub = tracker.subscribe(render);
        render();
        clock = win.setInterval(() => { if (tracker.isPlaying) progressPaint(); }, PROGRESS_TICK_MS);
        win.gBrowser.tabContainer.addEventListener("TabAttrModified", onTabAttr);
      },
      detach() {
        if (unsub) { unsub(); unsub = null; }
        if (clock) { win.clearInterval(clock); clock = 0; }
        win.gBrowser.tabContainer.removeEventListener("TabAttrModified", onTabAttr);
      },
    };
  }

  /* ----------------------------- the dropdown ------------------------------ */
  function createPlayerDropdown(doc, tracker) {
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
    const player = buildPlayerCard(doc, tracker, { onClose: () => panel.hidePopup() });
    panel.appendChild(player.card);
    panel.addEventListener("popupshown", () => player.attach());
    panel.addEventListener("popuphiding", () => player.detach());
    return {
      toggle(anchor) {
        if (panel.state === "open" || panel.state === "showing") panel.hidePopup();
        else panel.openPopup(anchor, { position: "bottomcenter topcenter" });
      },
      hide() { if (panel.state !== "closed") panel.hidePopup(); },
    };
  }

  /* ------------------------------- window API ------------------------------ */
  // One tracker per window, made on first use by whoever asks first: the
  // toolbar item (CustomizableUI's onBuild) or compact mode's dock() -- their
  // order at startup is not fixed.
  let tracker = null;
  let docked = null;
  win.CthulhuNowPlaying = {
    tracker() {
      if (!tracker) tracker = createMediaTracker();
      return tracker;
    },
    /** Mount a docked card into `container` (compact mode's sidebar). */
    dock(container) {
      if (docked) this.undock();
      docked = buildPlayerCard(container.ownerDocument, this.tracker(), { docked: true });
      container.appendChild(docked.card);
      docked.attach();
      return docked.card;
    },
    undock() {
      if (!docked) return;
      docked.detach();
      docked.card.remove();
      docked = null;
    },
    get isDocked() { return !!docked; },
    volume,
  };

  /* --- toolbar widget: build the DOM for THIS window (called by
   * NowPlayingWidget.sys.mjs's onBuild -- see that file for why the
   * CustomizableUI.createWidget() call lives there and not here). */
  window.__cthulhuBuildNowPlayingItem = function (doc) {
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

    const t = win.CthulhuNowPlaying.tracker();
    const dropdown = createPlayerDropdown(doc, t);
    setupNowPlaying({ squircle, title, artist: artistEl, fill }, t, () => dropdown.toggle(squircle));

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
