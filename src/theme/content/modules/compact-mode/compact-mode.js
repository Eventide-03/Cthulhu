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
 * TOGGLE: Ctrl/Cmd+Alt+C (Zen's shortcut), or "Compact mode" in the sidebar's
 * and the toolbar's right-click menus, or the pref. Turning it on also sets
 * `sidebar.visibility` to "always-show": upstream's own "expand-on-hover" and
 * "hide-sidebar" modes move the same element with inline styles and the two
 * would fight. Customize mode suspends it (the toolbox has to be in the flow
 * to be customised) and it resumes when customising ends.
 *
 * With horizontal tabs the pref is inert -- the tabs live in the toolbox. The
 * root carries [cthulhu-vertical-tabs] and, when active, [cthulhu-compact].
 * ============================================================================= */
(function () {
  "use strict";
  const PREF = "cthulhu.compact.mode";
  const VT_PREF = "sidebar.verticalTabs";
  const VIS_PREF = "sidebar.visibility";
  const ATTR = "cthulhu-compact";
  const VT_ATTR = "cthulhu-vertical-tabs";
  const OPEN_ATTR = "cthulhu-compact-open";
  const HIDE_DELAY_MS = 350;
  const COLUMN_W = 260; // px; the toolbox needs at least this to lay out its rows

  const win = window;
  const doc = win.document;
  const root = doc.documentElement;
  const getBool = (n, d) => { try { return Services.prefs.getBoolPref(n, d); } catch (e) { return d; } };

  const container = () => doc.getElementById("sidebar-container");
  const toolbox = () => doc.getElementById("navigator-toolbox");
  const parts = () => [container(), toolbox()].filter(Boolean);

  /* ------------------------------ open / close ------------------------------ */
  let hideTimer = 0;
  let popupsOpen = 0; // menus opened from inside the column hold it open

  function open() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    for (const el of parts()) if (!el.hasAttribute(OPEN_ATTR)) el.setAttribute(OPEN_ATTR, "");
  }
  function closeNow() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    for (const el of parts()) el.removeAttribute(OPEN_ATTR);
  }
  const hovered = () => parts().some((el) => el.matches(":hover"));
  // The address bar keeps the column open while it has focus: Cmd+L must
  // leave you typing into something you can see.
  const focusedInside = () => {
    const a = doc.activeElement;
    return !!a && parts().some((el) => el.contains(a));
  };
  function scheduleClose() {
    if (hideTimer) win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      hideTimer = 0;
      if (popupsOpen > 0 || hovered() || focusedInside()) return;
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
    root.style.setProperty("--cthulhu-compact-w", COLUMN_W + "px");
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
    // Keep it open while a menu opened from inside it is up.
    const from = (e) => {
      const p = e.target;
      const t = (p && (p.triggerNode || p.anchorNode)) || null;
      return !!(t && parts().some((el) => el.contains(t)));
    };
    doc.addEventListener("popupshown", (e) => { if (active() && from(e)) { popupsOpen++; open(); } });
    doc.addEventListener("popuphidden", (e) => {
      if (from(e) && popupsOpen > 0) { popupsOpen--; if (!popupsOpen) scheduleClose(); }
    });
    // Leaving the window altogether closes it (mouseleave does not always fire
    // when the pointer exits the window over the column).
    win.addEventListener("blur", () => { if (!popupsOpen) scheduleClose(); });
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

  /* --------------------------------- boot ---------------------------------- */
  function install() {
    installHotZone();
    installKey();
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
  Services.prefs.addObserver(PREF, observer);
  Services.prefs.addObserver(VT_PREF, observer);
  win.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
    Services.prefs.removeObserver(VT_PREF, observer);
  }, { once: true });

  if (doc.readyState === "complete") install();
  else win.addEventListener("load", install, { once: true });

  win.CthulhuCompactMode = {
    toggle,
    setEnabled,
    get enabled() { return getBool(PREF, false); },
    get active() { return active(); },
    open,
    close: closeNow,
  };
})();
