/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Compact mode for vertical tabs -- the Zen Browser behaviour.
 *
 * With vertical tabs on and `cthulhu.compact.mode` true, the vertical tab
 * strip (#sidebar-container, which holds <sidebar-main> and the tabs) is
 * taken out of the layout so the page gets the whole window, and slides back
 * in OVER the page while the pointer is at the window's edge or on the strip
 * itself. Leave it and it slides away again after a short delay. A context
 * menu opened from inside it (tab context menu, sidebar menu) keeps it open
 * until the menu closes, so a right-click does not pull the strip out from
 * under its own menu.
 *
 * Nothing here is re-implemented from upstream: the strip is upstream's own
 * sidebar, still resizable, still expanding/collapsing with its own button.
 * Only its place in the layout changes (compact-mode.css), and this file is
 * the plumbing: the hot zone at the edge, the open/close timing, the toggle.
 *
 * TOGGLE: Ctrl/Cmd+Alt+C (Zen's shortcut), or "Compact mode" in the sidebar's
 * and the toolbar's right-click menus, or the pref. Turning it on also sets
 * `sidebar.visibility` to "always-show": upstream's own "expand-on-hover" and
 * "hide-sidebar" modes move the same element with inline styles and the two
 * would fight.
 *
 * With horizontal tabs the pref is inert -- there is no strip to hide. The
 * root carries [cthulhu-vertical-tabs] and, when active, [cthulhu-compact], so
 * CSS elsewhere can tell.
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

  const win = window;
  const doc = win.document;
  const root = doc.documentElement;
  const getBool = (n, d) => { try { return Services.prefs.getBoolPref(n, d); } catch (e) { return d; } };

  const container = () => doc.getElementById("sidebar-container");

  /* ------------------------------ open / close ------------------------------ */
  let hideTimer = 0;
  let popupsOpen = 0; // menus opened from inside the strip hold it open

  function open() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    const c = container();
    if (c && !c.hasAttribute(OPEN_ATTR)) c.setAttribute(OPEN_ATTR, "");
  }
  function closeNow() {
    if (hideTimer) { win.clearTimeout(hideTimer); hideTimer = 0; }
    const c = container();
    if (c) c.removeAttribute(OPEN_ATTR);
  }
  function scheduleClose() {
    if (hideTimer) win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      hideTimer = 0;
      if (popupsOpen > 0) return;
      const c = container();
      if (c && c.matches(":hover")) return;
      closeNow();
    }, HIDE_DELAY_MS);
  }

  /* --------------------------------- state --------------------------------- */
  function active() {
    return getBool(PREF, false) && getBool(VT_PREF, false);
  }
  function sync() {
    const vt = getBool(VT_PREF, false);
    const on = vt && getBool(PREF, false);
    root.toggleAttribute(VT_ATTR, vt);
    root.toggleAttribute(ATTR, on);
    if (!on) closeNow();
    paintMenuItems();
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
  // A thin strip along the sidebar's edge of the content area. It is the only
  // thing left of the sidebar while it is hidden, so it is what the pointer
  // finds when it goes looking for the tabs. Also a drop target: dragging a
  // link or a tab to the edge opens the strip so it can be dropped on it.
  function installHotZone() {
    const browserBox = doc.getElementById("browser");
    if (!browserBox || doc.getElementById("cthulhu-compact-hotzone")) return;
    const hot = doc.createElement("div");
    hot.id = "cthulhu-compact-hotzone";
    hot.addEventListener("mouseenter", open);
    hot.addEventListener("dragenter", open);
    browserBox.appendChild(hot);

    const c = container();
    if (c) {
      c.addEventListener("mouseenter", open);
      c.addEventListener("mouseleave", scheduleClose);
      c.addEventListener("dragleave", scheduleClose);
    }
    // Keep it open while a menu opened from inside it is up.
    const from = (e) => {
      const cc = container();
      if (!cc) return false;
      const p = e.target;
      const t = (p && (p.triggerNode || p.anchorNode)) || null;
      return !!(t && cc.contains(t));
    };
    doc.addEventListener("popupshown", (e) => { if (active() && from(e)) { popupsOpen++; open(); } });
    doc.addEventListener("popuphidden", (e) => {
      if (from(e) && popupsOpen > 0) { popupsOpen--; if (!popupsOpen) scheduleClose(); }
    });
    // Leaving the window altogether closes it (mouseleave does not always fire
    // when the pointer exits the window over the strip).
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
