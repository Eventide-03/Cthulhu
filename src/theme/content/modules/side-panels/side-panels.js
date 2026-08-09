/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Side panels: one toolbar row (left of the extensions button) holding three
 * service toggles (Discord/Instagram/Apple Music, real favicons) plus a
 * "Now Playing" squircle showing whatever media is currently playing across
 * any tab. Toggling a service opens a right-hand sidebar hosting that
 * service's REAL web app as a full browser view (not an iframe, not a custom
 * client -- see the README for why that matters). Clicking the squircle opens
 * a separate dropdown player (a real XUL <panel>, not the sidebar).
 *
 * Three independent pieces, all set up per-window from
 * __cthulhuBuildSidePanelsItem (called by SidePanelsWidget.sys.mjs's onBuild,
 * once per browser window):
 *   - createMediaTracker() -- shared "what's playing right now" state, polled
 *                              once per window and fanned out to subscribers
 *                              (the squircle AND the dropdown player both
 *                              render from the same tracker instead of
 *                              polling/attaching to MediaController twice).
 *   - setupNowPlaying()    -- the squircle readout; renders from the tracker.
 *   - createPlayerDropdown() -- the dropdown player popup.
 *   - setupSidePanels()    -- the toggle buttons (built into the toolbar
 *                              item, not the sidebar, so they're always
 *                              visible) + the resizable sidebar itself.
 *
 * Runs in the browser-window scope (see loader.js). CustomizableUI's ES module
 * import is cached by the module loader, so importing it from every window's
 * copy of this script is cheap, not a fresh load.
 * ============================================================================= */
(function () {
  "use strict";
  const ID = "side-panels";
  const ASSET = "chrome://cthulhu/content/modules/side-panels/assets/";
  const RESIZE_PREF = "cthulhu.sidepanels.width";
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 800;

  const SERVICES = [
    { id: "discord", name: "Discord", url: "https://discord.com/app", host: "discord.com", icon: ASSET + "discord-icon.png" },
    { id: "instagram", name: "Instagram", url: "https://www.instagram.com/", host: "instagram.com", icon: ASSET + "instagram-icon.png" },
    { id: "apple-music", name: "Apple Music", url: "https://music.apple.com/listen-now", host: "music.apple.com", icon: ASSET + "apple-music-icon.png" },
  ];

  // Each toggle's icon is the SITE'S OWN favicon -- what you'd see on its tab
  // if you opened it normally -- not a hand-drawn substitute. Same
  // fetch-and-inline technique as the quick-links widget: a live <img src>
  // to a remote URL is blocked on privileged pages/chrome, but a plain
  // fetch() isn't, so the bytes are fetched and inlined as a data URL. The
  // ASSET placeholder above is used as the button background only until this
  // resolves (or if every source fails).
  const _cthFaviconCache = Object.create(null); // host -> data URL (session cache)
  async function _cthFetchFavicon(host) {
    if (_cthFaviconCache[host]) return _cthFaviconCache[host];
    const sources = [
      "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64",
      "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico",
      "https://" + host + "/favicon.ico",
    ];
    for (const u of sources) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const blob = await r.blob();
        if (blob.size < 80) continue; // skip empty/1x1 placeholder responses
        const dataUrl = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
        if (dataUrl) { _cthFaviconCache[host] = dataUrl; return dataUrl; }
      } catch (e) {}
    }
    return null;
  }

  /* ---------------------------------------------------------------------
   * Side panels: toggle buttons + persistent <browser> per service.
   *
   * Each service's <browser> is a real, remote, content-type browser --
   * exactly the mechanism Firefox itself uses to host a WebExtension's
   * sidebar_action page (see webext-panels.js), just without the extra
   * document that pattern needs for its own reasons. It's created fresh the
   * first time its toggle is clicked (never eagerly).
   *
   * Persistence model: once opened, a service's browser STAYS ALIVE (still
   * running, still connected -- e.g. Discord's websocket keeps receiving
   * events) even after switching to another service or closing the sidebar
   * with the × button, exactly like leaving a real app running in the
   * background. The × button only hides the SIDEBAR; it never tears anything
   * down. The only way to actually shut a panel down -- discard its browser,
   * end its content process, stop costing anything -- is the power button in
   * its header (opposite the ×). This means the "zero background cost"
   * guarantee only holds for panels that have never been opened, or that
   * were explicitly powered off; an opened-and-left-running panel is a
   * deliberate choice to keep it live (see README for the full rationale).
   *
   * Web Notifications: PopupNotifications (toolkit/modules/PopupNotifications
   * .sys.mjs) only shows a permission doorhanger for gBrowser.selectedBrowser
   * -- our panel browsers aren't tabs, so by default their prompts would be
   * silently dropped. Fixed at the source: see the
   * toolkit/modules/PopupNotifications-sys-mjs.patch this project carries,
   * which also treats a browser marked [cthulhu-sidepanel-active] as active.
   * We set that attribute on exactly the currently-VISIBLE panel browser
   * (the one whose sidebar content is on screen) -- a backgrounded, still-
   * running panel doesn't get permission-prompt anchoring, since that prompt
   * is only ever expected the first time you open a service, which is
   * necessarily while it's visible.
   * --------------------------------------------------------------------- */
  /** @param toggleHost element (in the toolbar, next to the squircle) that
   * the three service toggle buttons get appended into -- they live in the
   * toolbar, not the sidebar, so they're visible whether or not anything is
   * currently open.
   * @returns the window's CthulhuSidePanels API (created once per window). */
  function setupSidePanels(win, toggleHost) {
    if (win.CthulhuSidePanels) return win.CthulhuSidePanels; // already set up for this window
    const doc = win.document;

    function getSavedWidth() {
      let w = 380;
      try { w = Services.prefs.getIntPref(RESIZE_PREF, 380); } catch (e) {}
      return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    }

    const container = doc.createElement("div");
    container.id = "cthulhu-sidepanels";
    container.hidden = true;
    container.style.width = getSavedWidth() + "px";

    const resizeHandle = doc.createElement("div");
    resizeHandle.className = "cthulhu-sp-resize";
    resizeHandle.title = "Drag to resize";
    resizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // Set the start state FIRST -- setPointerCapture can throw (e.g. a
      // pointerId the platform never registered as active), which would
      // otherwise abort the rest of this handler and silently break the
      // very first drag of a session.
      resizeHandle._startX = e.clientX;
      resizeHandle._startWidth = container.getBoundingClientRect().width;
      resizeHandle.classList.add("dragging");
      try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    resizeHandle.addEventListener("pointermove", (e) => {
      if (!(e.buttons & 1) || resizeHandle._startX == null) return;
      // Dragging LEFT grows the panel -- it's docked to the right edge, so
      // its left edge is what's actually moving under the cursor.
      const delta = resizeHandle._startX - e.clientX;
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeHandle._startWidth + delta));
      container.style.width = w + "px";
    });
    resizeHandle.addEventListener("pointerup", () => {
      resizeHandle._startX = null;
      resizeHandle.classList.remove("dragging");
      try { Services.prefs.setIntPref(RESIZE_PREF, Math.round(container.getBoundingClientRect().width)); } catch (e) {}
    });

    const header = doc.createElement("div");
    header.className = "cthulhu-sp-header";

    const content = doc.createElement("div");
    content.className = "cthulhu-sp-content";

    const browsers = new Map(); // service id -> <browser>, present only while powered on
    let activeService = null; // id of the currently VISIBLE service, or null

    function setBadge(id, show) {
      const btn = toggleHost.querySelector('.cthulhu-sp-toggle[data-service="' + id + '"]');
      const dot = btn && btn.querySelector(".cthulhu-sp-badge");
      if (dot) dot.hidden = !show;
    }

    // Discord/Instagram both render an unread count as a leading "(N) ..."
    // in the tab title (confirmed via tabbrowser.js's own pagetitlechanged
    // usage -- the same event it listens to for its own tab-title unread
    // dots). Only badge services that AREN'T the currently visible one --
    // no point telling you about unread messages in the panel you're already
    // looking at.
    function watchUnread(id, b) {
      const onTitle = () => {
        let t = "";
        try { t = b.contentTitle || ""; } catch (e) {}
        const m = /^\((\d+)\)/.exec(t);
        const count = m ? parseInt(m[1], 10) : 0;
        setBadge(id, count > 0 && activeService !== id);
      };
      b.addEventListener("pagetitlechanged", onTitle);
    }

    function destroyPanel(id) {
      const b = browsers.get(id);
      if (!b) return;
      b.removeAttribute("cthulhu-sidepanel-active");
      b.remove(); // disconnectedCallback tears down the frameLoader/content process
      browsers.delete(id);
    }

    function createPanel(svc) {
      const b = doc.createXULElement("browser");
      b.setAttribute("type", "content");
      b.setAttribute("disableglobalhistory", "true");
      b.setAttribute("messagemanagergroup", "cthulhu-sidepanels");
      b.setAttribute("context", "contentAreaContextMenu");
      b.setAttribute("remote", "true");
      b.setAttribute("maychangeremoteness", "true");
      b.setAttribute("remoteType", ChromeUtils.predictRemoteTypeForURI(svc.url, { window: win }));
      b.className = "cthulhu-sp-browser";
      b.setAttribute("data-cthulhu-service", svc.id); // for CSS/debugging; not read by this module itself
      b.hidden = true;
      content.appendChild(b);
      const sp = Services.scriptSecurityManager.getSystemPrincipal();
      b.fixupAndLoadURIString(svc.url, { triggeringPrincipal: sp });
      browsers.set(svc.id, b);
      watchUnread(svc.id, b);
      return b;
    }

    function paintToggles() {
      for (const btn of toggleHost.querySelectorAll(".cthulhu-sp-toggle")) {
        btn.classList.toggle("active", btn.dataset.service === activeService);
      }
    }

    function paintContent() {
      for (const [id, b] of browsers) b.hidden = id !== activeService;
    }

    /** Show `id`'s panel (creating/powering it on if needed) in the sidebar.
     * Previously-shown panels are hidden, NOT destroyed -- they keep running
     * in the background (see the persistence-model note above). Pass `url`
     * to also navigate the panel (creating it if needed) -- used by the
     * dropdown player's search/recommend shortcuts to jump Apple Music to a
     * specific page. */
    function showService(id, url) {
      const svc = SERVICES.find((s) => s.id === id);
      if (!svc) return;
      const b = browsers.get(id) || createPanel(svc);
      if (url) {
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        b.fixupAndLoadURIString(url, { triggeringPrincipal: sp });
      }
      if (activeService && activeService !== id) {
        const prev = browsers.get(activeService);
        if (prev) prev.removeAttribute("cthulhu-sidepanel-active");
      }
      b.setAttribute("cthulhu-sidepanel-active", "true");
      activeService = id;
      container.hidden = false;
      // The sidebar is z-indexed above everything, but the urlbar's native
      // toolbarbuttons (bookmark star, identity/permission icons, ...) still
      // render through it regardless -- confirmed live: they're plain
      // `position: static` XUL toolbarbuttons with no elevated z-index of
      // their own, yet still paint above a `position: fixed` + very-high-
      // z-index sibling, evidently via Gecko's own chrome-widget compositing
      // rather than standard CSS stacking. Fighting that isn't reliable,
      // so the search bar is hidden outright while a panel is open instead
      // (see side-panels.css) -- which is also just what was asked for: the
      // panel should overlap/cover the search bar, not visually clash with it.
      doc.documentElement.setAttribute("cthulhu-sidepanel-open", "true");
      setBadge(id, false); // opening it counts as having seen it
      paintContent();
      paintToggles();
    }

    /** Hide the sidebar. Does NOT power off whatever's showing -- it keeps
     * running in the background; see powerOff() for actually shutting a
     * panel down. */
    function closeAll() {
      container.hidden = true;
      doc.documentElement.removeAttribute("cthulhu-sidepanel-open");
      paintToggles();
    }

    /** Actually shut a service's panel down: discard its browser (ending its
     * content process), until it's opened again. If it was the visible one,
     * the sidebar closes too since there's nothing left to show. */
    function powerOff(id) {
      if (!browsers.has(id)) return;
      destroyPanel(id);
      setBadge(id, false);
      if (activeService === id) {
        activeService = null;
        closeAll();
      } else {
        paintToggles();
      }
    }

    function toggleService(id) {
      if (activeService === id && !container.hidden) closeAll();
      else showService(id);
    }

    for (const svc of SERVICES) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "cthulhu-sp-toggle";
      btn.dataset.service = svc.id;
      btn.title = svc.name;
      btn.style.backgroundImage = 'url("' + svc.icon + '")'; // placeholder until the real favicon (below) resolves
      btn.addEventListener("click", () => toggleService(svc.id));
      const badge = doc.createElement("span");
      badge.className = "cthulhu-sp-badge";
      badge.hidden = true;
      btn.appendChild(badge);
      toggleHost.appendChild(btn);
      _cthFetchFavicon(svc.host).then((d) => { if (d) btn.style.backgroundImage = 'url("' + d + '")'; });
    }

    const powerBtn = doc.createElement("button");
    powerBtn.type = "button";
    powerBtn.className = "cthulhu-sp-power";
    powerBtn.title = "Shut down this panel";
    powerBtn.textContent = "⏻";
    powerBtn.addEventListener("click", () => { if (activeService) powerOff(activeService); });
    header.appendChild(powerBtn);

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cthulhu-sp-close";
    closeBtn.title = "Close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeAll);
    header.appendChild(closeBtn);

    container.append(resizeHandle, header, content);
    doc.documentElement.appendChild(container);

    win.addEventListener("unload", () => {
      for (const id of Array.from(browsers.keys())) destroyPanel(id);
    });

    win.CthulhuSidePanels = {
      /** Toggle the whole sidebar: closed -> open on the last/​first service; open -> closed. */
      toggle() {
        if (container.hidden) showService(activeService || SERVICES[0].id);
        else closeAll();
      },
      open: showService,
      close: closeAll,
      toggleService,
      powerOff,
      getActive: () => activeService,
    };
    return win.CthulhuSidePanels;
  }

  /* ---------------------------------------------------------------------
   * Shared media tracking: aggregates each tab's chrome-only
   * browsingContext.mediaController (title/artist/artwork/position via
   * events -- see MediaController.webidl) into one "what's playing right
   * now" readout, polled and fanned out once per window to any number of
   * subscribers (the squircle and the dropdown player both render from this
   * SAME tracker instead of each polling/attaching independently). There is
   * no single built-in "any tab" event for this (the closest thing, the
   * "main-media-controller-changed" observer topic, is gated behind the
   * testing-only media.mediacontrol.testingevents.enabled pref and isn't
   * meant for production use), so this polls every tab's controller flags on
   * a short interval and picks the best candidate itself -- cheap (a handful
   * of boolean reads), not the same "background cost" the side panels'
   * power-on/off model is about.
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
      else notify(); // just re-extrapolate the progress bar between position events
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
      let meta = null;
      try { meta = current.mc.getMetadata(); } catch (e) {} // throws if the controller went inactive between the poll and here
      title.textContent = (meta && meta.title) || current.tab.label || "";
      artist.textContent = (meta && meta.artist) || "";
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
   * squircle, opened on click instead of the sidebar. Real popups render in
   * the OS-level popup layer, immune to the chrome-widget-compositing quirk
   * noted above -- no urlbar-hiding workaround needed here. Transport
   * controls call straight into the tracker's current MediaController
   * (play/pause/prevTrack/nextTrack/seekTo -- see MediaController.webidl);
   * there's no volume-LEVEL API on that interface at all, so "mute" toggles
   * the tab's own audioMuted flag instead of pretending to be an analog
   * slider it can't actually be. Recommended tiles + search both just open/
   * navigate the Apple Music panel via win.CthulhuSidePanels.open(id, url) --
   * not personalized recommendations (no API access for that), generic
   * browse-section shortcuts.
   * --------------------------------------------------------------------- */
  function createPlayerDropdown(win, tracker, sidePanels) {
    const doc = win.document;
    const popupset = doc.getElementById("mainPopupSet") || doc.documentElement;

    const panel = doc.createXULElement("panel");
    panel.id = "cthulhu-player-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("flip", "both");
    // panel-no-padding: our own .cthulhu-player-card supplies its own 12px
    // padding -- without this, the default arrow-panel content padding (see
    // toolkit's popup.css) stacks with it unevenly.
    panel.className = "cthulhu-player-popup panel-no-padding";
    popupset.appendChild(panel);

    const card = doc.createElement("div");
    card.className = "cthulhu-player-card";
    panel.appendChild(card);

    const art = doc.createElement("div");
    art.className = "cthulhu-player-art";
    const artImg = doc.createElement("img");
    artImg.className = "cthulhu-player-art-img";
    artImg.hidden = true;
    art.appendChild(artImg);

    const titleEl = doc.createElement("div");
    titleEl.className = "cthulhu-player-title";
    const artistEl = doc.createElement("div");
    artistEl.className = "cthulhu-player-artist";

    const progress = doc.createElement("div");
    progress.className = "cthulhu-player-progress";
    const progressFill = doc.createElement("div");
    progressFill.className = "cthulhu-player-progress-fill";
    progress.appendChild(progressFill);

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

    const controls = doc.createElement("div");
    controls.className = "cthulhu-player-controls";
    const prevBtn = doc.createElement("button");
    prevBtn.type = "button"; prevBtn.className = "cthulhu-player-ctrl"; prevBtn.title = "Previous"; prevBtn.textContent = "⏮";
    const playBtn = doc.createElement("button");
    playBtn.type = "button"; playBtn.className = "cthulhu-player-play"; playBtn.title = "Play/Pause"; playBtn.textContent = "▶";
    const nextBtn = doc.createElement("button");
    nextBtn.type = "button"; nextBtn.className = "cthulhu-player-ctrl"; nextBtn.title = "Next"; nextBtn.textContent = "⏭";
    const muteBtn = doc.createElement("button");
    muteBtn.type = "button"; muteBtn.className = "cthulhu-player-ctrl"; muteBtn.title = "Mute"; muteBtn.textContent = "🔊";
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

    const recommend = doc.createElement("div");
    recommend.className = "cthulhu-player-section";
    const recLabel = doc.createElement("div");
    recLabel.className = "cthulhu-player-section-label";
    recLabel.textContent = "Browse Apple Music";
    const recList = doc.createElement("div");
    recList.className = "cthulhu-player-recommend-list";
    const RECS = [
      { label: "Top Charts", url: "https://music.apple.com/us/browse" },
      { label: "New Releases", url: "https://music.apple.com/us/new" },
      { label: "Radio", url: "https://music.apple.com/us/radio" },
      { label: "Playlists", url: "https://music.apple.com/us/browse/playlists" },
    ];
    for (const rec of RECS) {
      const tile = doc.createElement("button");
      tile.type = "button";
      tile.className = "cthulhu-player-rec-tile";
      tile.textContent = rec.label;
      tile.addEventListener("click", () => {
        panel.hidePopup();
        sidePanels.open("apple-music", rec.url);
      });
      recList.appendChild(tile);
    }
    recommend.append(recLabel, recList);

    const searchRow = doc.createElement("div");
    searchRow.className = "cthulhu-player-search";
    const searchInput = doc.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search songs & playlists…";
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = searchInput.value.trim();
      if (!q) return;
      panel.hidePopup();
      sidePanels.open("apple-music", "https://music.apple.com/us/search?term=" + encodeURIComponent(q));
      searchInput.value = "";
    });
    searchRow.appendChild(searchInput);

    card.append(art, titleEl, artistEl, progress, controls, recommend, searchRow);

    function render() {
      const current = tracker.current;
      if (!current) {
        titleEl.textContent = "Nothing playing";
        artistEl.textContent = "";
        artImg.hidden = true;
        progressFill.style.width = "0%";
        playBtn.textContent = "▶";
        playBtn.disabled = true;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        muteBtn.disabled = true;
        return;
      }
      let meta = null;
      try { meta = current.mc.getMetadata(); } catch (e) {}
      titleEl.textContent = (meta && meta.title) || current.tab.label || "";
      artistEl.textContent = (meta && meta.artist) || "";
      const art0 = meta && meta.artwork && meta.artwork[0];
      if (art0 && art0.src) { artImg.src = art0.src; artImg.hidden = false; } else { artImg.hidden = true; }
      playBtn.disabled = false;
      playBtn.textContent = current.mc.isPlaying ? "⏸" : "▶";
      const supported = current.mc.supportedKeys || [];
      prevBtn.disabled = !supported.includes("previoustrack");
      nextBtn.disabled = !supported.includes("nexttrack");
      muteBtn.disabled = false;
      const muted = !!current.tab.linkedBrowser.audioMuted;
      muteBtn.textContent = muted ? "🔇" : "🔊";
      muteBtn.classList.toggle("muted", muted);
      const pos = tracker.extrapolatedPosition();
      if (pos != null && tracker.duration > 0) progressFill.style.width = (pos / tracker.duration) * 100 + "%";
      else progressFill.style.width = current.mc.isPlaying ? "100%" : "0%";
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
   * SidePanelsWidget.sys.mjs's onBuild, which runs once per window per
   * CustomizableUI's own instantiation -- see that file for why the
   * CustomizableUI.createWidget() call itself lives there instead of here:
   * getWidget(id)?.provider is not a reliable "already registered" check
   * (Firefox's own comment on getWidgetProvider(): it optimistically
   * guesses PROVIDER_XUL for literally any unrecognized id, "the API is
   * technically lying"), so that call needs the real once-per-process
   * guarantee an ES module's import cache gives, not a manual flag. */
  window.__cthulhuBuildSidePanelsItem = function (doc) {
    const win = doc.defaultView;
    const item = doc.createXULElement("toolbaritem");
    item.id = "cthulhu-nowplaying";
    item.classList.add("chromeclass-toolbar-additional", "cthulhu-nowplaying-item");

    // Service toggles first (left), squircle last (right, closest to the
    // extensions button) -- both live in this one toolbar item so they're
    // always in the same row, whether or not any panel is currently open.
    const toggles = doc.createElement("div");
    toggles.className = "cthulhu-sp-toggles";

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
    item.append(toggles, squircle);

    const sidePanels = setupSidePanels(win, toggles);
    const tracker = createMediaTracker(win);
    const dropdown = createPlayerDropdown(win, tracker, sidePanels);
    setupNowPlaying(win, { squircle, title, artist: artistEl, fill }, tracker, () => dropdown.toggle(squircle));

    // Placing this "immediately before the extensions button" via
    // CustomizableUI's placement-array index is a race at startup: at the
    // moment this module runs, the extensions button isn't reliably in the
    // navbar's placements array yet (confirmed live: indexOf came back -1,
    // so the position argument silently fell back to "append at the end" and
    // the widget landed AFTER it instead of before). A plain DOM move after
    // insertion sidesteps that race entirely -- correct regardless of
    // whether CustomizableUI's own bookkeeping has caught up yet.
    win.setTimeout(() => {
      const ext = doc.getElementById("unified-extensions-button");
      if (ext?.parentNode && ext.previousElementSibling !== item) {
        ext.parentNode.insertBefore(item, ext);
      }
    }, 0);

    return item;
  };

  try {
    ChromeUtils.importESModule("chrome://cthulhu/content/modules/side-panels/SidePanelsWidget.sys.mjs");
  } catch (e) {
    console.error("[Cthulhu:" + ID + "] widget registration failed:", e);
  }
})();
