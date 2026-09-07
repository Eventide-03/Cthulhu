/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Feature-request form, opened by clicking the Rishi pet (see pet.js). This
 * used to be a widget of its own; it is now a modal that the pet loads on
 * demand, so the home page carries no permanent "send feedback" tile.
 *
 * Same relay, same contract, same states as the toolbar button in
 * modules/feature-request. The Discord webhook is never in this browser: all
 * this knows is the relay URL from the pref `cthulhu.relay.url`. See
 * relay/README.md.
 *
 * NOTE: about:cthulhu runs with the system principal, and assigning innerHTML
 * there goes through Gecko's chrome-fragment sanitizer, which silently DROPS
 * <button>, <input> and <select>. Every control is therefore built with
 * createElement -- see widgets/README.md.
 *
 * Loaded lazily, so it registers itself on window rather than assuming a
 * loader. Platform-neutral: no platform branches anywhere. */
(function () {
  "use strict";
  if (window.CthulhuRishiRequest) return;

  const MAX = 1500; // must match the relay's cap
  const PREF_URL = "cthulhu.relay.url";
  const STYLE_ID = "cthulhu-rishi-request-style";

  function pref(name, fallback) {
    try { return Services.prefs.getStringPref(name, fallback); } catch (e) { return fallback; }
  }
  function platform() {
    let os = "";
    let abi = "";
    try { os = Services.appinfo.OS || ""; abi = Services.appinfo.XPCOMABI || ""; } catch (e) {}
    const pretty = os === "WINNT" ? "Windows" : os === "Darwin" ? "macOS" : os || "Unknown";
    const arch = abi.split("-")[0];
    return arch ? pretty + " (" + arch + ")" : pretty;
  }
  function version() {
    try { return Services.appinfo.version || ""; } catch (e) { return ""; }
  }

  const CSS = `
    .cw-rr { gap:8px; }
    .cw-rr-sub, .cw-rr-meta { font-size:.75em; color:var(--fg-muted); }
    .cw-rr textarea, .cw-rr input[type="text"] {
      width:100%; box-sizing:border-box; padding:7px 9px; background:var(--bg);
      border:1px solid var(--border); border-radius:8px; color:var(--fg);
      font-family:var(--font-pixel); font-size:.9em; outline:none; resize:none;
    }
    .cw-rr textarea { min-height:110px; }
    .cw-rr textarea:focus, .cw-rr input:focus { border-color:var(--accent); }
    .cw-rr textarea::placeholder, .cw-rr input::placeholder { color:var(--fg-muted); }
    .cw-rr-actions { display:flex; gap:8px; align-items:center; }
    .cw-rr-send {
      padding:8px 12px; background:var(--accent); color:var(--fg-on-accent);
      border:none; border-radius:8px; font-family:var(--font-pixel);
      font-weight:700; font-size:.9em; cursor:pointer;
    }
    .cw-rr-send:hover:not(:disabled) { background:var(--accent-hover); }
    .cw-rr-send:disabled { opacity:.6; cursor:default; }
    .cw-rr-close { background:var(--surface); color:var(--fg); border:1px solid var(--border); }
    .cw-rr-status { font-size:.75em; line-height:1.35; min-height:1.35em; }
    .cw-rr[data-state="sending"] .cw-rr-status { color:var(--fg-muted); }
    .cw-rr[data-state="sent"]    .cw-rr-status { color:var(--accent); }
    .cw-rr[data-state="failed"]  .cw-rr-status { color:var(--notify); }
  `;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function open() {
    if (document.querySelector(".cw-rr-modal")) return;
    ensureStyle();

    // Same overlay + panel classes as the ⚙ config modal, so it looks like part
    // of the same system and sits above the grid.
    const overlay = document.createElement("div");
    overlay.className = "cthulhu-config-modal cw-rr-modal";
    const panel = document.createElement("div");
    panel.className = "cthulhu-widget-config cw-rr";
    panel.setAttribute("data-state", "idle");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Feature request");
    overlay.appendChild(panel);

    const title = document.createElement("h3");
    title.className = "cthulhu-config-title";
    title.textContent = "Feature request";
    panel.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "cw-rr-sub";
    sub.textContent = "Goes straight to the developer.";
    panel.appendChild(sub);

    const message = document.createElement("textarea");
    message.setAttribute("maxlength", String(MAX));
    message.placeholder = "What would you like to see?";
    message.setAttribute("aria-label", "Your feature request");
    panel.appendChild(message);

    const name = document.createElement("input");
    name.type = "text";
    name.setAttribute("maxlength", "80");
    name.placeholder = "Your name (optional)";
    name.setAttribute("aria-label", "Your name, optional");
    panel.appendChild(name);

    const status = document.createElement("div");
    status.className = "cw-rr-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "cw-rr-actions";
    const send = document.createElement("button");
    send.type = "button";
    send.className = "cw-rr-send";
    send.textContent = "Send";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cw-rr-send cw-rr-close";
    close.textContent = "Close";
    actions.appendChild(send);
    actions.appendChild(close);
    panel.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "cw-rr-meta";
    meta.textContent = "Cthulhu " + version() + " on " + platform();
    panel.appendChild(meta);

    let state = "idle";
    const setState = (next, text) => {
      state = next;
      panel.setAttribute("data-state", next);
      status.textContent = text || "";
      send.disabled = next === "sending";
      message.disabled = next === "sending";
      name.disabled = next === "sending";
      send.textContent = next === "sending" ? "Sending..." : next === "sent" ? "Sent" : "Send";
    };
    message.addEventListener("input", () => {
      if (state === "sent" || state === "failed") setState("idle", "");
    });

    async function submit() {
      if (state === "sending") return;
      const text = message.value.trim();
      if (!text) { setState("failed", "Write something first."); message.focus(); return; }
      const url = pref(PREF_URL, "").trim();
      if (!url) { setState("failed", "No relay configured (" + PREF_URL + ")."); return; }

      setState("sending", "Sending...");
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-cthulhu-client": "1" },
          body: JSON.stringify({
            message: text,
            name: name.value.trim() || undefined,
            version: version(),
            platform: platform(),
          }),
        });
        let payload = null;
        try { payload = await resp.json(); } catch (e) { /* non-JSON error page */ }
        if (resp.ok && payload && payload.ok) {
          setState("sent", "Thanks. Your request was sent.");
          message.value = "";
          return;
        }
        setState("failed",
          (payload && payload.error) ||
          (resp.status === 429 ? "Too many requests. Try again in a minute."
                               : "Could not send (error " + resp.status + ")."));
      } catch (e) {
        // Offline / DNS / TLS all land here. Keep the user's text.
        setState("failed", "Could not reach the network. Your text is saved -- try again.");
      }
    }

    const dismiss = () => overlay.remove();
    send.addEventListener("click", submit);
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
    });

    document.body.appendChild(overlay);
    message.focus();
    return overlay;
  }

  window.CthulhuRishiRequest = { open };
})();
