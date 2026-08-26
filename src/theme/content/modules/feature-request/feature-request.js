/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Feature-request module.
 *
 * A toolbar button that opens a small themed form and POSTs the message to the
 * Cthulhu relay (a Cloudflare Worker), which forwards it to Discord.
 *
 * The Discord webhook is NOT in this browser and never will be -- strings are
 * recoverable from a binary and the repo is public. All this knows is the
 * relay's public URL, from the pref `cthulhu.relay.url`.
 *
 * PLATFORM-NEUTRAL: everything here is XUL/DOM plus Services.appinfo, so it
 * behaves identically on Windows, macOS and Linux. No platform branches.
 * ============================================================================= */
(function () {
  "use strict";

  const win = window;
  const doc = win.document;
  const ID = "feature-request";
  const ASSET = "chrome://cthulhu/content/modules/feature-request/assets/";
  const PREF_URL = "cthulhu.relay.url";
  const MAX = 1500; // must match the relay's cap

  const relayUrl = () => {
    try {
      return Services.prefs.getStringPref(PREF_URL, "").trim();
    } catch (e) {
      return "";
    }
  };

  /** Human-readable platform, e.g. "Windows (x86_64)" / "macOS (aarch64)". */
  function platformLabel() {
    let os = "";
    let abi = "";
    try {
      os = Services.appinfo.OS || "";
      abi = Services.appinfo.XPCOMABI || "";
    } catch (e) {
      /* fall through to whatever we have */
    }
    const pretty =
      os === "WINNT" ? "Windows" : os === "Darwin" ? "macOS" : os || "Unknown";
    const arch = abi.split("-")[0];
    return arch ? pretty + " (" + arch + ")" : pretty;
  }

  const appVersion = () => {
    try {
      return Services.appinfo.version || "";
    } catch (e) {
      return "";
    }
  };

  // ---- panel ---------------------------------------------------------------
  function buildPanel() {
    const panel = doc.createXULElement("panel");
    panel.id = "cthulhu-feature-request-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "false");
    panel.classList.add("panel-no-padding");

    const box = doc.createElement("div");
    box.className = "cthulhu-fr";

    const title = doc.createElement("div");
    title.className = "cthulhu-fr-title";
    title.textContent = "Send a feature request";
    box.appendChild(title);

    const sub = doc.createElement("div");
    sub.className = "cthulhu-fr-sub";
    sub.textContent = "Goes straight to the developer.";
    box.appendChild(sub);

    const message = doc.createElement("textarea");
    message.className = "cthulhu-fr-message";
    message.setAttribute("rows", "5");
    message.setAttribute("maxlength", String(MAX));
    message.setAttribute("placeholder", "What would you like to see?");
    message.setAttribute("aria-label", "Your feature request");
    box.appendChild(message);

    const counter = doc.createElement("div");
    counter.className = "cthulhu-fr-counter";
    box.appendChild(counter);

    const name = doc.createElement("input");
    name.className = "cthulhu-fr-name";
    name.type = "text";
    name.setAttribute("maxlength", "80");
    name.setAttribute("placeholder", "Your name (optional)");
    name.setAttribute("aria-label", "Your name, optional");
    box.appendChild(name);

    const meta = doc.createElement("div");
    meta.className = "cthulhu-fr-meta";
    meta.textContent = "Sent with: Cthulhu " + appVersion() + " on " + platformLabel();
    box.appendChild(meta);

    const status = doc.createElement("div");
    status.className = "cthulhu-fr-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    box.appendChild(status);

    const send = doc.createElement("button");
    send.className = "cthulhu-fr-send";
    send.textContent = "Send";
    box.appendChild(send);

    panel.appendChild(box);
    doc.getElementById("mainPopupSet")?.appendChild(panel);

    // ---- state machine -----------------------------------------------------
    // idle -> sending -> sent | failed. Only `sending` disables the controls, so
    // a failure always leaves the text intact and re-sendable.
    let state = "idle";
    const setState = (next, text) => {
      state = next;
      box.setAttribute("data-state", next);
      status.textContent = text || "";
      send.disabled = next === "sending";
      message.disabled = next === "sending";
      name.disabled = next === "sending";
      send.textContent =
        next === "sending" ? "Sending..." : next === "sent" ? "Sent" : "Send";
    };

    const updateCounter = () => {
      const left = MAX - message.value.length;
      counter.textContent = left < 200 ? left + " characters left" : "";
    };
    message.addEventListener("input", () => {
      updateCounter();
      if (state === "sent" || state === "failed") {
        setState("idle", "");
      }
    });

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
      const url = relayUrl();
      if (!url) {
        setState(
          "failed",
          "No relay configured. Set " + PREF_URL + " in about:config."
        );
        return;
      }

      setState("sending", "Sending...");
      try {
        const resp = await win.fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Forces a preflight for web callers, which the relay refuses.
            "x-cthulhu-client": "1",
          },
          body: JSON.stringify({
            message: text,
            name: name.value.trim() || undefined,
            version: appVersion(),
            platform: platformLabel(),
          }),
        });

        let body = null;
        try {
          body = await resp.json();
        } catch (e) {
          /* non-JSON error page; fall back to status below */
        }

        if (resp.ok && body && body.ok) {
          setState("sent", "Thanks. Your request was sent.");
          message.value = "";
          updateCounter();
          win.setTimeout(() => {
            if (state === "sent") {
              panel.hidePopup();
            }
          }, 1400);
          return;
        }

        // The relay returns a human-readable `error` for every rejection it
        // controls; only fall back to a status code when it does not.
        setState(
          "failed",
          (body && body.error) ||
            (resp.status === 429
              ? "Too many requests. Try again in a minute."
              : "Could not send (error " + resp.status + ").")
        );
      } catch (e) {
        // Offline, DNS failure, TLS failure -- all land here. Never blame the
        // user's text for a network problem, and never drop what they typed.
        console.warn("[Cthulhu:" + ID + "] send failed:", e);
        setState("failed", "Could not reach the network. Your text is saved -- try again.");
      }
    }

    send.addEventListener("click", submit);
    // Ctrl/Cmd+Enter submits, matching the usual convention for a textarea form.
    message.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    panel.addEventListener("popupshown", () => {
      setState("idle", "");
      updateCounter();
      message.focus();
    });

    return panel;
  }

  // ---- toolbar button ------------------------------------------------------
  function install() {
    if (doc.getElementById("cthulhu-feature-request-button")) {
      return;
    }
    const navbar =
      doc.getElementById("nav-bar")?.customizationTarget ||
      doc.getElementById("nav-bar");
    if (!navbar) {
      console.warn("[Cthulhu:" + ID + "] no #nav-bar; button not installed");
      return;
    }

    const button = doc.createXULElement("toolbarbutton");
    button.id = "cthulhu-feature-request-button";
    button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    button.setAttribute("label", "Feature request");
    button.setAttribute("tooltiptext", "Send a feature request");
    /* ART SLOT: assets/feature-request-16.png (16x16; 32x32 supplied for HiDPI).
       Replace both with your own pixel art at the same sizes. */
    button.style.listStyleImage = "url(" + ASSET + "feature-request-16.png)";

    let panel = null;
    button.addEventListener("command", () => {
      if (!panel || !panel.isConnected) {
        panel = buildPanel();
      }
      panel.openPopup(button, "bottomcenter topright", 0, 0, false, false);
    });

    navbar.appendChild(button);
  }

  if (doc.readyState === "complete") {
    install();
  } else {
    win.addEventListener("load", install, { once: true });
  }
})();
