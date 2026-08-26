/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Feature-request widget -- the home-page twin of the toolbar button in
 * modules/feature-request. Same relay, same contract, same states.
 *
 * The Discord webhook is never in this browser: this only knows the relay URL
 * from the pref `cthulhu.relay.url`. See relay/README.md.
 *
 * NOTE: about:cthulhu runs with the system principal, and assigning innerHTML
 * there goes through Gecko's chrome-fragment sanitizer, which silently DROPS
 * <button>, <input> and <select>. Every control below is therefore built with
 * createElement -- see widgets/README.md.
 *
 * Platform-neutral: no platform branches anywhere. */

(function () {
  "use strict";

  const MAX = 1500; // must match the relay's cap
  const PREF_URL = "cthulhu.relay.url";

  function _cthFrPref(name, fallback) {
    try {
      return Services.prefs.getStringPref(name, fallback);
    } catch (e) {
      return fallback;
    }
  }

  function _cthFrPlatform() {
    let os = "";
    let abi = "";
    try {
      os = Services.appinfo.OS || "";
      abi = Services.appinfo.XPCOMABI || "";
    } catch (e) {
      /* use what we have */
    }
    const pretty =
      os === "WINNT" ? "Windows" : os === "Darwin" ? "macOS" : os || "Unknown";
    const arch = abi.split("-")[0];
    return arch ? pretty + " (" + arch + ")" : pretty;
  }

  function _cthFrVersion() {
    try {
      return Services.appinfo.version || "";
    } catch (e) {
      return "";
    }
  }

  CthulhuWidgets.register({
    id: "feature-request",
    category: "utility",
    name: "Feature request",
    defaultSize: { w: 4, h: 4 },
    defaultConfig: {},

    css: `
      .cw-fr { display:flex; flex-direction:column; gap:6px; height:100%; box-sizing:border-box; }
      .cw-fr-title { font-weight:700; }
      .cw-fr-sub, .cw-fr-meta { font-size:.75em; color:var(--fg-muted); }
      .cw-fr textarea, .cw-fr input {
        width:100%; box-sizing:border-box; padding:7px 9px; background:var(--bg-elevated);
        border:1px solid var(--border); border-radius:8px; color:var(--fg);
        font-family:var(--font-pixel); font-size:.9em; outline:none; resize:none;
      }
      .cw-fr textarea { flex:1; min-height:48px; }
      .cw-fr textarea:focus, .cw-fr input:focus { border-color:var(--accent); }
      .cw-fr textarea::placeholder, .cw-fr input::placeholder { color:var(--fg-muted); }
      .cw-fr-send {
        padding:8px 10px; background:var(--accent); color:var(--fg-on-accent);
        border:none; border-radius:8px; font-family:var(--font-pixel);
        font-weight:700; font-size:.9em; cursor:pointer;
      }
      .cw-fr-send:hover:not(:disabled) { background:var(--accent-hover); }
      .cw-fr-send:disabled { opacity:.6; cursor:default; }
      .cw-fr-status { font-size:.75em; line-height:1.35; min-height:1.35em; }
      .cw-fr[data-state="sending"] .cw-fr-status { color:var(--fg-muted); }
      .cw-fr[data-state="sent"]    .cw-fr-status { color:var(--accent); }
      .cw-fr[data-state="failed"]  .cw-fr-status { color:var(--notify); }
    `,

    render(body, ctx) {
      const wrap = document.createElement("div");
      wrap.className = "cw-fr";
      wrap.setAttribute("data-state", "idle");

      const title = document.createElement("div");
      title.className = "cw-fr-title";
      title.textContent = "Feature request";
      wrap.appendChild(title);

      const sub = document.createElement("div");
      sub.className = "cw-fr-sub";
      sub.textContent = "Goes straight to the developer.";
      wrap.appendChild(sub);

      const message = document.createElement("textarea");
      message.setAttribute("maxlength", String(MAX));
      message.placeholder = "What would you like to see?";
      message.setAttribute("aria-label", "Your feature request");
      wrap.appendChild(message);

      const name = document.createElement("input");
      name.type = "text";
      name.setAttribute("maxlength", "80");
      name.placeholder = "Your name (optional)";
      name.setAttribute("aria-label", "Your name, optional");
      wrap.appendChild(name);

      const status = document.createElement("div");
      status.className = "cw-fr-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      wrap.appendChild(status);

      const send = document.createElement("button");
      send.className = "cw-fr-send";
      send.textContent = "Send";
      wrap.appendChild(send);

      const meta = document.createElement("div");
      meta.className = "cw-fr-meta";
      meta.textContent = "Cthulhu " + _cthFrVersion() + " on " + _cthFrPlatform();
      wrap.appendChild(meta);

      body.appendChild(wrap);

      let state = "idle";
      const setState = (next, text) => {
        state = next;
        wrap.setAttribute("data-state", next);
        status.textContent = text || "";
        send.disabled = next === "sending";
        message.disabled = next === "sending";
        name.disabled = next === "sending";
        send.textContent =
          next === "sending" ? "Sending..." : next === "sent" ? "Sent" : "Send";
      };

      message.addEventListener("input", () => {
        if (state === "sent" || state === "failed") {
          setState("idle", "");
        }
      });

      // The tile is drag-enabled, so stop pointer events on the controls from
      // being interpreted as the start of a grid drag.
      for (const el of [message, name, send]) {
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
      }

      async function submit() {
        if (state === "sending") {
          return;
        }
        const text = message.value.trim();
        if (!text) {
          setState("failed", "Write something first.");
          message.focus();
          return;
        }
        const url = _cthFrPref(PREF_URL, "").trim();
        if (!url) {
          setState("failed", "No relay configured (" + PREF_URL + ").");
          return;
        }

        setState("sending", "Sending...");
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-cthulhu-client": "1",
            },
            body: JSON.stringify({
              message: text,
              name: name.value.trim() || undefined,
              version: _cthFrVersion(),
              platform: _cthFrPlatform(),
            }),
          });

          let payload = null;
          try {
            payload = await resp.json();
          } catch (e) {
            /* non-JSON error page; fall back to the status code */
          }

          if (resp.ok && payload && payload.ok) {
            setState("sent", "Thanks. Your request was sent.");
            message.value = "";
            return;
          }
          setState(
            "failed",
            (payload && payload.error) ||
              (resp.status === 429
                ? "Too many requests. Try again in a minute."
                : "Could not send (error " + resp.status + ").")
          );
        } catch (e) {
          // Offline / DNS / TLS all land here. Keep the user's text.
          setState("failed", "Could not reach the network. Your text is saved -- try again.");
        }
      }

      send.addEventListener("click", submit);
      message.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    },
  });
})();
