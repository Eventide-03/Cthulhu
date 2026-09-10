/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Admin panel for the home page.
 *
 * Hidden behind the pref `cthulhu.admin.enabled` (default false). Turn it on in
 * about:config and a small button appears next to the widget-settings gear;
 * it opens a panel of owner-side controls.
 *
 * WHAT "ADMIN" MEANS HERE, HONESTLY: the pref is a DISCOVERABILITY gate, not
 * a security boundary. The source is public and the pref is documented, so
 * anyone can switch the panel on for their own copy. What protects the
 * controls that reach OTHER PEOPLE is the ADMIN TOKEN: a secret the owner
 * sets on the relay (`wrangler secret put ADMIN_TOKEN`, relay/README.md) and
 * types into the "Relay" section below, where it is kept in a pref on this
 * machine only. Without the token every control still works, but locally; a
 * copy of the browser with the panel switched on and no token can change
 * nothing for anyone else. Nothing secret is ever in the binary, where it
 * would be extractable.
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
 * ctx gives you { ui, getPref, setPref, relay, close } -- ui is the same shared
 * control kit the widget config panels use (see widgets.js), and relay is
 * { url, token, get(path), put(path, body) } for a control that has a
 * server-side value.
 *
 * NOTE: about:cthulhu runs with the system principal, and assigning innerHTML
 * there goes through Gecko's chrome-fragment sanitizer, which silently DROPS
 * <button>, <input> and <select>. Build controls with createElement.
 * ============================================================================= */
"use strict";

(function () {
  const PREF_ENABLED = "cthulhu.admin.enabled";
  const PREF_TOKEN = "cthulhu.admin.token";
  const PREF_RELAY = "cthulhu.relay.url";

  const prefs = () => (typeof Services !== "undefined" && Services.prefs) || null;
  const getBool = (n, d) => { try { return prefs().getBoolPref(n, d); } catch (e) { return d; } };
  const getStr = (n, d) => { try { return prefs().getStringPref(n, d); } catch (e) { return d; } };
  const setStr = (n, v) => {
    try { prefs().setStringPref(n, v); return true; }
    catch (e) { console.warn("[Cthulhu:admin] pref", n, e.message); return false; }
  };

  /* ------------------------------- the relay ------------------------------- */
  // Thin client for the Worker in relay/. Reads need no token; writes carry it
  // as a bearer token. Errors are plain Error objects with a readable message.
  const relay = {
    url: () => getStr(PREF_RELAY, "").trim().replace(/\/+$/, ""),
    token: () => getStr(PREF_TOKEN, "").trim(),
    async get(path) {
      const base = relay.url();
      if (!base) throw new Error("No relay configured (" + PREF_RELAY + ").");
      const resp = await fetch(base + path, { headers: { "x-cthulhu-client": "1" } });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || "HTTP " + resp.status);
      return data;
    },
    async put(path, body) {
      const base = relay.url();
      if (!base) throw new Error("No relay configured (" + PREF_RELAY + ").");
      const token = relay.token();
      if (!token) throw new Error("No admin token set.");
      const resp = await fetch(base + path, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-cthulhu-client": "1",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || (resp.status === 401 ? "The relay rejected the token." : "HTTP " + resp.status));
      }
      return data;
    },
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
    relay,
    /** Exposed so a section can react to its own pref changing elsewhere. */
    prefs: { getStr, setStr, getBool },
  };
  window.CthulhuAdmin = CthulhuAdmin;

  /* --------------------------- built-in: the token -------------------------- */
  CthulhuAdmin.register({
    id: "relay",
    title: "Relay",
    note: "Controls that reach the other browser go through the relay and need " +
      "its admin token. Kept in this profile only; never shipped.",
    render(body, ctx) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; gap:6px; align-items:center;";
      const input = document.createElement("input");
      input.type = "password";
      input.placeholder = "admin token";
      input.setAttribute("aria-label", "Relay admin token");
      input.autocomplete = "off";
      input.value = relay.token();
      const show = document.createElement("button");
      show.type = "button";
      show.className = "cw-ui-btn";
      show.textContent = "show";
      show.addEventListener("click", (e) => {
        e.stopPropagation();
        input.type = input.type === "password" ? "text" : "password";
        show.textContent = input.type === "password" ? "show" : "hide";
      });
      row.appendChild(input);
      row.appendChild(show);
      body.appendChild(row);

      const status = document.createElement("div");
      status.className = "cthulhu-admin-note";
      body.appendChild(status);

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "cw-cfg-save";
      save.textContent = "Save token";
      save.addEventListener("click", (e) => {
        e.stopPropagation();
        setStr(PREF_TOKEN, input.value.trim());
        status.textContent = input.value.trim() ? "Saved." : "Cleared -- controls now change this machine only.";
      });
      const test = document.createElement("button");
      test.type = "button";
      test.className = "cw-ui-btn";
      test.textContent = "Test";
      test.addEventListener("click", async (e) => {
        e.stopPropagation();
        setStr(PREF_TOKEN, input.value.trim());
        status.textContent = "Checking…";
        try {
          await relay.put("/rishi", {}); // an empty patch: proves the token, changes nothing
          status.textContent = "The relay accepted the token.";
        } catch (err) {
          status.textContent = "Failed: " + err.message;
        }
      });
      actions.appendChild(save);
      actions.appendChild(test);
      body.appendChild(actions);
      const where = document.createElement("div");
      where.className = "cthulhu-admin-note";
      where.textContent = "Relay: " + (relay.url() || "(none -- set " + PREF_RELAY + ")");
      body.appendChild(where);
    },
  });

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
    sub.textContent = "Turn the panel off again with " + PREF_ENABLED + " in about:config.";
    panel.appendChild(sub);

    const ctx = {
      ui: window.CthulhuWidgets && window.CthulhuWidgets.ui,
      getPref: getStr,
      setPref: setStr,
      relay,
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
      box.dataset.section = s.id;
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
