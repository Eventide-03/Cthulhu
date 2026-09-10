/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Compact mode for vertical tabs -- the Zen Browser layout.
 *
 * With vertical tabs on and `cthulhu.compact.mode` true, the page gets the
 * WHOLE window. Everything that is chrome lives in one column at the window's
 * edge -- the navigation toolbar (back / forward / reload, the address bar on
 * its own row, the menu), the tabs, and the player docked at the bottom -- and
 * that column stays off-screen until the pointer touches the edge, the
 * address bar takes focus (Cmd/Ctrl+L), or a menu is opened from inside it.
 * Leave it and it slides away again after a short delay.
 *
 * HOW, WITHOUT BREAKING FIREFOX: nothing is moved in the DOM. The toolbox
 * (#navigator-toolbox) is a sibling above the browser area; compact-mode.css
 * takes it out of the flow with position:absolute at the top-left, gives it
 * the column's width and lets its buttons wrap, and pads the top of
 * #sidebar-container (upstream's box around <sidebar-main>) by the toolbox's
 * measured height so the tabs start under it. CustomizableUI, the urlbar's
 * breakout popover and customize mode all keep working because every element
 * is still where they expect it in the tree. The player card is the only
 * thing added: now-playing.js mounts a docked copy at the bottom of the column
 * (and the toolbar squircle is hidden while it is there).
 *
 * WIDTH: drag the column's inner edge (a 6px grab strip, #cthulhu-compact-
 * resizer). Everything in the column is sized by --cthulhu-compact-w, so the
 * toolbox, the tabs and the player follow together; the width is kept in
 * `cthulhu.compact.width`.
 *
 * TOGGLE: Ctrl/Cmd+Alt+C (Zen's shortcut), or "Compact mode" in the sidebar's
 * and the toolbar's right-click menus, or the pref. Turning it on also sets
 * `sidebar.visibility` to "always-show": upstream's own "expand-on-hover" and
 * "hide-sidebar" modes move the same element with inline styles and the two
 * would fight. Customize mode suspends it (the toolbox has to be in the flow
 * to be customised) and it resumes when customising ends.
 *
 * With horizontal tabs the pref is inert -- the tabs live in the toolbox. The
 * root carries [cthulhu-vertical-tabs] and, when active, [cthulhu-compact].
 *
 * ALSO HERE, because it is about the same strip: the sidebar launcher after
 * vertical tabs are turned off again. Upstream sets sidebar.visibility to
 * "always-show" when they go on and to "hide-sidebar" when they go off
 * (SidebarManager.handleVerticalTabsPrefChange), and its "hide-sidebar" rule
 * for horizontal tabs is "launcher visible initially" -- so a window that had
 * the launcher hidden got it back, open, every time vertical tabs were tried
 * and undone, to be closed by hand. This remembers whether the launcher was
 * showing while the tabs were horizontal and puts it back that way.
 * ============================================================================= */
(function () {
  "use strict";
  const PREF = "cthulhu.compact.mode";
  const W_PREF = "cthulhu.compact.width";
  const VT_PREF = "sidebar.verticalTabs";
  const VIS_PREF = "sidebar.visibility";
  const ATTR = "cthulhu-compact";
  const VT_ATTR = "cthulhu-vertical-tabs";
  const OPEN_ATTR = "cthulhu-compact-open";
  const HIDE_DELAY_MS = 350;
  const WATCHDOG_MS = 1500;
  const COLUMN_W = 260; // px; the default -- the toolbox lays its rows out well at this
  const MIN_W = 200; // narrower and the address bar is a stub
  const MAX_W = 520;

  const win = window;
  const doc = win.document;
  const root = doc.documentElement;
  const getBool = (n, d) => { try { return Services.prefs.getBoolPref(n, d); } catch (e) { return d; } };
  const getInt = (n, d) => { try { return Services.prefs.getIntPref(n, d); } catch (e) { return d; } };
  const columnWidth = () => Math.max(MIN_W, Math.min(MAX_W, getInt(W_PREF, COLUMN_W)));

  const container = () => doc.getElementById("sidebar-container");
  const toolbox = () => doc.getElementById("navigator-toolbox");
  const parts = () => [container(), toolbox()].filter(Boolean);

  /* ------------------------------ open / close ------------------------------ */
  let hideTimer = 0;
  let watchdog = 0;
  let dragging = false; // the width grip is being dragged
  // Popups opened from inside the column hold it open. Tracked by the popup
  // NODE: by the time popuphidden fires its triggerNode is already null, so
  // a count that checked the trigger on both ends went up on show and never
  // came down -- one tooltip over a tab and the column stayed out for good.
  const openPopups = new Set();

  const hovered = () => parts().some((el) => el.matches(":hover"));
  // Focus holds the column open only where it is something you type into
  // (the address bar: Cmd+L must leave you typing into something you can
  // see) or arrived by keyboard (:focus-visible). A tab or button that merely
  // kept focus from a click does not -- that pinned the column open after a
  // click on the current tab until focus happened to move.
  const focusedInside = () => {
    const a = doc.activeElement;
    if (!a || !parts().some((el) => el.contains(a))) return false;
    if (a.closest && a.closest("#urlbar, #searchbar, input, textarea, [contenteditable]")) return true;
    try { return a.matches(":focus-visible"); } catch (e) { return false; }
  };
  const wanted = () => dragging || openPopups.size > 0 || hovered() || focusedInside();

  function open() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    for (const el of parts()) if (!el.hasAttribute(OPEN_ATTR)) el.setAttribute(OPEN_ATTR, "");
    // Belt and braces: while it is out, look every so often whether anything
    // still wants it out. Covers a mouseleave that never came (the pointer
    // left across a native widget, say) -- the "sometimes it stays" case.
    if (!watchdog) watchdog = win.setInterval(() => { if (!wanted()) closeNow(); }, WATCHDOG_MS);
  }
  function closeNow() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    if (watchdog) { win.clearInterval(watchdog); watchdog = 0; }
    for (const el of parts()) el.removeAttribute(OPEN_ATTR);
  }
  function scheduleClose() {
    if (hideTimer) win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      hideTimer = 0;
      if (wanted()) return;
      closeNow();
    }, HIDE_DELAY_MS);
  }

  /* --------------------------------- state --------------------------------- */
  let suspended = false; // customize mode
  let observers = [];
  function active() {
    return getBool(PREF, false) && getBool(VT_PREF, false) && !suspended;
  }
  function sync() {
    const vt = getBool(VT_PREF, false);
    const on = vt && getBool(PREF, false) && !suspended;
    root.toggleAttribute(VT_ATTR, vt);
    const was = root.hasAttribute(ATTR);
    root.toggleAttribute(ATTR, on);
    if (on && !was) activate();
    if (!on && was) deactivate();
    paintMenuItems();
  }
  function activate() {
    root.style.setProperty("--cthulhu-compact-w", columnWidth() + "px");
    // The tabs start under the toolbox: pad by its live height.
    const tb = toolbox();
    if (tb && typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => {
        root.style.setProperty("--cthulhu-compact-toolbox-h", tb.getBoundingClientRect().height + "px");
      });
      ro.observe(tb);
      observers.push(ro);
    }
    if (tb) root.style.setProperty("--cthulhu-compact-toolbox-h", tb.getBoundingClientRect().height + "px");
    // The player, docked at the bottom of the column.
    const c = container();
    if (c && win.CthulhuNowPlaying) {
      try { win.CthulhuNowPlaying.dock(c); } catch (e) { console.error("[Cthulhu:compact-mode] dock:", e); }
    }
  }
  function deactivate() {
    closeNow();
    for (const ro of observers) ro.disconnect();
    observers = [];
    root.style.removeProperty("--cthulhu-compact-w");
    root.style.removeProperty("--cthulhu-compact-toolbox-h");
    if (win.CthulhuNowPlaying) {
      try { win.CthulhuNowPlaying.undock(); } catch (e) {}
    }
  }

  function setEnabled(on) {
    try {
      if (on && Services.prefs.getCharPref(VIS_PREF, "always-show") !== "always-show") {
        Services.prefs.setCharPref(VIS_PREF, "always-show");
      }
      Services.prefs.setBoolPref(PREF, !!on);
    } catch (e) {
      console.error("[Cthulhu:compact-mode] pref:", e);
    }
  }
  const toggle = () => setEnabled(!getBool(PREF, false));

  /* ------------------------------- hot zone --------------------------------- */
  // A thin strip along the column's edge of the content area. It is the only
  // thing left of the chrome while the column is hidden, so it is what the
  // pointer finds when it goes looking. Also a drop target: dragging a link
  // or a tab to the edge opens the column so it can be dropped on it.
  function installHotZone() {
    const browserBox = doc.getElementById("browser");
    if (!browserBox || doc.getElementById("cthulhu-compact-hotzone")) return;
    const hot = doc.createElement("div");
    hot.id = "cthulhu-compact-hotzone";
    hot.addEventListener("mouseenter", open);
    hot.addEventListener("dragenter", open);
    browserBox.appendChild(hot);

    for (const el of parts()) {
      el.addEventListener("mouseenter", open);
      el.addEventListener("mouseleave", scheduleClose);
      el.addEventListener("dragleave", scheduleClose);
      // Focus arriving anywhere in the column (Cmd+L, tabbing into it) opens
      // it; focus leaving lets it close.
      el.addEventListener("focusin", () => { if (active()) open(); });
      el.addEventListener("focusout", () => { if (active()) scheduleClose(); });
    }
    // Keep it open while a menu opened from inside it is up (see openPopups).
    // A tooltip is a popup too, but it holds nothing.
    const from = (e) => {
      const p = e.target;
      const t = (p && (p.triggerNode || p.anchorNode)) || null;
      return !!(t && parts().some((el) => el.contains(t)));
    };
    doc.addEventListener("popupshown", (e) => {
      if (!active() || e.target.localName === "tooltip" || !from(e)) return;
      openPopups.add(e.target);
      open();
    });
    doc.addEventListener("popuphidden", (e) => {
      if (openPopups.delete(e.target) && !openPopups.size) scheduleClose();
    });
    // Leaving the window altogether closes it (mouseleave does not always fire
    // when the pointer exits the window over the column).
    win.addEventListener("blur", () => { if (!openPopups.size) scheduleClose(); });
  }

  /* -------------------------------- the width ------------------------------- */
  // A 6px grab strip along the column's inner edge. Dragging it sets
  // --cthulhu-compact-w, which sizes the toolbox, the tabs and the player
  // alike, and the width is kept in a pref. Upstream's own splitter is hidden
  // in compact mode: it sat between strip and page, and there is no between.
  function installResizer() {
    const c = container();
    if (!c || doc.getElementById("cthulhu-compact-resizer")) return;
    const grip = doc.createElement("div");
    grip.id = "cthulhu-compact-resizer";
    grip.title = "Drag to resize";
    c.appendChild(grip);
    let startX = 0;
    let startW = 0;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !active()) return;
      dragging = true;
      startX = e.clientX;
      startW = c.getBoundingClientRect().width;
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      root.setAttribute("cthulhu-compact-resizing", "");
      open();
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const fromEnd = c.hasAttribute("sidebar-positionend"); // the column on the right grows leftwards
      const w = Math.round(Math.max(MIN_W, Math.min(MAX_W, startW + (fromEnd ? startX - e.clientX : e.clientX - startX))));
      root.style.setProperty("--cthulhu-compact-w", w + "px");
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      root.removeAttribute("cthulhu-compact-resizing");
      const w = Math.round(parseFloat(root.style.getPropertyValue("--cthulhu-compact-w")) || COLUMN_W);
      try { Services.prefs.setIntPref(W_PREF, w); } catch (err) {}
      scheduleClose();
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("lostpointercapture", end);
  }

  /* -------------------------------- toggles -------------------------------- */
  function installKey() {
    const keyset = doc.getElementById("mainKeyset");
    if (!keyset || doc.getElementById("key_cthulhuCompactMode")) return;
    const key = doc.createXULElement("key");
    key.id = "key_cthulhuCompactMode";
    key.setAttribute("modifiers", "accel,alt");
    key.setAttribute("key", "C");
    key.addEventListener("command", toggle);
    keyset.appendChild(key);
  }

  const menuItems = [];
  function installMenuItem(menuId, afterId) {
    const menu = doc.getElementById(menuId);
    if (!menu || menu.querySelector(".cthulhu-compact-menuitem")) return;
    const item = doc.createXULElement("menuitem");
    item.className = "cthulhu-compact-menuitem";
    item.setAttribute("type", "checkbox");
    item.setAttribute("label", "Compact mode");
    item.setAttribute("accesskey", "C");
    item.setAttribute("key", "key_cthulhuCompactMode");
    item.addEventListener("command", toggle);
    const after = doc.getElementById(afterId);
    if (after && after.parentNode === menu) after.after(item);
    else menu.appendChild(item);
    menuItems.push(item);
    menu.addEventListener("popupshowing", paintMenuItems);
  }
  function paintMenuItems() {
    const vt = getBool(VT_PREF, false);
    const on = getBool(PREF, false);
    for (const it of menuItems) {
      it.hidden = !vt; // meaningless without a vertical strip to hide
      it.setAttribute("checked", String(on));
    }
  }

  /* ----------------------- the launcher, afterwards ------------------------ */
  // Whether the launcher (the tool strip, <sidebar-main> with horizontal tabs)
  // was showing the last time the tabs were horizontal. A pref, so a restart
  // between turning vertical tabs on and off does not lose it. It is read off
  // the container's own hidden attribute -- the one thing upstream's
  // launcherVisible setter always writes -- whenever that changes while the
  // tabs are horizontal, except during the moments after they go horizontal,
  // when upstream is busy showing it "initially" and the answer is not the
  // user's.
  const LAUNCHER_PREF = "cthulhu.sidebar.launcherShownHorizontal";
  let launcherSettleUntil = 0;
  // Our own view of the orientation, moved only by our own observer below.
  // Upstream's observer for the same pref runs first (or not -- the order
  // depends on which lazy getter was touched first) and writes
  // sidebar.visibility, whose observer would otherwise catch the launcher
  // mid-change and remember upstream's "shown initially" as the user's.
  let tabsHorizontal = !getBool(VT_PREF, false);
  function rememberLauncher() {
    if (!tabsHorizontal || Date.now() < launcherSettleUntil) return;
    const c = container();
    if (!c) return;
    const shown = !c.hidden;
    if (getBool(LAUNCHER_PREF, true) !== shown) {
      try { Services.prefs.setBoolPref(LAUNCHER_PREF, shown); } catch (e) {}
    }
  }
  function restoreLauncher() {
    if (getBool(VT_PREF, false) || getBool(LAUNCHER_PREF, true)) return;
    const sc = win.SidebarController;
    const state = sc && sc._state;
    if (!state || state.launcherVisible === false) return;
    let vis = "";
    try { vis = Services.prefs.getCharPref(VIS_PREF, ""); } catch (e) {}
    if (vis !== "hide-sidebar") return; // in the other modes it cannot be hidden anyway
    try {
      state.updateVisibility(false);
      sc.updateToolbarButton();
    } catch (e) {
      console.error("[Cthulhu:compact-mode] launcher:", e);
    }
  }
  function onTabsHorizontalAgain() {
    // Upstream's observers have shown the launcher or are about to; its
    // orientation work finishes on later ticks. Nothing is remembered until
    // that has settled and the restore below has had its say.
    launcherSettleUntil = Date.now() + 1500;
    tabsHorizontal = true;
    win.setTimeout(restoreLauncher, 0);
    win.setTimeout(restoreLauncher, 700);
  }
  function installLauncherMemory() {
    const c = container();
    if (!c || typeof MutationObserver !== "function") return;
    const mo = new MutationObserver(rememberLauncher);
    mo.observe(c, { attributes: true, attributeFilter: ["hidden"] });
    win.addEventListener("unload", () => mo.disconnect(), { once: true });
    // Session restore settles the launcher a little after load.
    win.setTimeout(rememberLauncher, 3000);
  }

  /* --------------------------------- boot ---------------------------------- */
  function install() {
    installHotZone();
    installResizer();
    installKey();
    installLauncherMemory();
    installMenuItem("sidebar-context-menu", "sidebar-context-menu-enable-vertical-tabs");
    installMenuItem("toolbar-context-menu", "toolbar-context-toggle-vertical-tabs");
    // Customize mode needs the toolbox in the normal flow.
    const tb = toolbox();
    if (tb) {
      tb.addEventListener("customizationstarting", () => { suspended = true; sync(); });
      tb.addEventListener("customizationending", () => { suspended = false; sync(); });
    }
    sync();
  }
  const observer = { observe() { sync(); } };
  const vtObserver = { observe() {
    const vt = getBool(VT_PREF, false);
    if (vt) tabsHorizontal = false; else onTabsHorizontalAgain();
    sync();
  } };
  const visObserver = { observe() { rememberLauncher(); } };
  const wObserver = { observe() { if (active()) root.style.setProperty("--cthulhu-compact-w", columnWidth() + "px"); } };
  Services.prefs.addObserver(PREF, observer);
  Services.prefs.addObserver(VT_PREF, vtObserver);
  Services.prefs.addObserver(VIS_PREF, visObserver);
  Services.prefs.addObserver(W_PREF, wObserver);
  win.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
    Services.prefs.removeObserver(VT_PREF, vtObserver);
    Services.prefs.removeObserver(VIS_PREF, visObserver);
    Services.prefs.removeObserver(W_PREF, wObserver);
  }, { once: true });

  if (doc.readyState === "complete") install();
  else win.addEventListener("load", install, { once: true });

  win.CthulhuCompactMode = {
    toggle,
    setEnabled,
    get enabled() { return getBool(PREF, false); },
    get active() { return active(); },
    get width() { return columnWidth(); },
    open,
    close: closeNow,
  };
})();
