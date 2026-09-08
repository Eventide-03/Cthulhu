/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Admin panel for the home page.
 *
 * Hidden behind the pref `cthulhu.admin.enabled` (default false). Turn it on in
 * about:config and a small button appears next to the widget-settings gear;
 * it opens a panel of developer-side controls.
 *
 * WHAT "ADMIN" MEANS HERE, HONESTLY: this is a DISCOVERABILITY gate, not a
 * security boundary. The source is public and the pref is documented, so
 * anyone can switch it on for their own copy. That is fine, because everything
 * in this panel only affects the machine it runs on -- there is nothing here
 * worth protecting. If a control ever needs to change something for OTHER
 * people, it cannot be gated this way: it would need a secret the user supplies
 * (not one shipped in the binary, which is extractable), and a server to hold
 * the value. See the note on Rishi's mood below.
 *
 * ADDING A CONTROL: sections self-register, the same convention the widget
 * registry uses, so this file's own list never needs editing:
 *
 *   CthulhuAdmin.register({
 *     id: "my-thing",
 *     title: "My thing",
 *     note: "one line explaining what it affects",   // optional
 *     render(body, ctx) { ... }                      // build DOM into `body`
 *   });
 *
 * ctx gives you { ui, getPref, setPref, close } -- ui is the same shared
 * control kit the widget config panels use (see widgets.js), so a new section
 * looks like the rest of the browser for free.
 *
 * NOTE: about:cthulhu runs with the system principal, and assigning innerHTML
 * there goes through Gecko's chrome-fragment sanitizer, which silently DROPS
 * <button>, <input> and <select>. Build controls with createElement.
 * ============================================================================= */
"use strict";

(function () {
  const PREF_ENABLED = "cthulhu.admin.enabled";

  const prefs = () => (typeof Services !== "undefined" && Services.prefs) || null;
  const getBool = (n, d) => { try { return prefs().getBoolPref(n, d); } catch (e) { return d; } };
  const getStr = (n, d) => { try { return prefs().getStringPref(n, d); } catch (e) { return d; } };
  const setStr = (n, v) => {
    try { prefs().setStringPref(n, v); return true; }
    catch (e) { console.warn("[Cthulhu:admin] pref", n, e.message); return false; }
  };

  const sections = [];

  const CthulhuAdmin = {
    register(def) {
      if (!def || !def.id || typeof def.render !== "function") {
        console.warn("[Cthulhu:admin] ignoring a section with no id/render");
        return;
      }
      if (sections.some((s) => s.id === def.id)) return;
      sections.push(def);
      return def;
    },
    all: () => sections.slice(),
    get enabled() { return getBool(PREF_ENABLED, false); },
    open,
    close,
    /** Exposed so a section can react to its own pref changing elsewhere. */
    prefs: { getStr, setStr, getBool },
  };
  window.CthulhuAdmin = CthulhuAdmin;

  /* ------------------------------- the panel ------------------------------- */
  function close() {
    const m = document.querySelector(".cthulhu-admin-modal");
    if (m) m.remove();
  }

  function open() {
    if (document.querySelector(".cthulhu-admin-modal")) { close(); return; }
    // Same overlay + panel classes as the widget config modal, so it is
    // obviously part of the same system and sits above the grid.
    const overlay = document.createElement("div");
    overlay.className = "cthulhu-config-modal cthulhu-admin-modal";
    const panel = document.createElement("div");
    panel.className = "cthulhu-widget-config cthulhu-admin";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Admin");
    overlay.appendChild(panel);

    const title = document.createElement("h3");
    title.className = "cthulhu-config-title";
    title.textContent = "Admin";
    panel.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "cthulhu-admin-note";
    sub.textContent = "Local to this machine. Turn the panel off again with " +
      PREF_ENABLED + " in about:config.";
    panel.appendChild(sub);

    const ctx = {
      ui: window.CthulhuWidgets && window.CthulhuWidgets.ui,
      getPref: getStr,
      setPref: setStr,
      close,
    };

    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "cthulhu-admin-note";
      empty.textContent = "No admin sections are registered.";
      panel.appendChild(empty);
    }
    for (const s of sections) {
      const box = document.createElement("div");
      box.className = "cthulhu-admin-sec";
      const h = document.createElement("div");
      h.className = "cthulhu-admin-sec-title";
      h.textContent = s.title || s.id;
      box.appendChild(h);
      if (s.note) {
        const n = document.createElement("div");
        n.className = "cthulhu-admin-note";
        n.textContent = s.note;
        box.appendChild(n);
      }
      const body = document.createElement("div");
      body.className = "cthulhu-admin-sec-body";
      box.appendChild(body);
      panel.appendChild(box);
      try { s.render(body, ctx); }
      catch (e) { console.error("[Cthulhu:admin] section", s.id, e); }
    }

    const done = document.createElement("button");
    done.type = "button";
    done.className = "cw-cfg-save";
    done.textContent = "Done";
    done.addEventListener("click", close);
    panel.appendChild(done);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
    document.body.appendChild(overlay);
    const first = panel.querySelector("input, button");
    if (first) first.focus();
  }

  /* ------------------------------ the button ------------------------------- */
  function mountButton() {
    if (!CthulhuAdmin.enabled) return;
    if (document.getElementById("cthulhu-admin-btn")) return;
    const b = document.createElement("button");
    b.id = "cthulhu-admin-btn";
    b.type = "button";
    b.textContent = "admin";
    b.title = "Admin panel";
    b.setAttribute("aria-label", "Admin panel");
    b.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    document.body.appendChild(b);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton, { once: true });
  } else {
    mountButton();
  }
  // The widget scripts register their sections after this file runs, but the
  // button only needs to exist -- sections are read when the panel opens.
})();
