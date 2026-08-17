/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Google Calendar auth + API layer for the calendar widget.
 *
 * OAuth 2.0 authorization-code flow with PKCE, using the "installed app"
 * loopback redirect (https://developers.google.com/identity/protocols/oauth2/native-app):
 * we listen on 127.0.0.1 on an OS-assigned port, send Google there as the
 * redirect_uri, and read the ?code= back off the request line. Google allows
 * any port on the loopback interface for Desktop-app clients, so nothing has
 * to be registered up front beyond the client itself.
 *
 * This works because about:cthulhu runs with the system principal in the
 * parent process (see AboutCthulhu.sys.mjs), which gives the page both
 * nsIServerSocket and cross-origin fetch. Verified live before this was built.
 *
 * WHY THE USER SUPPLIES THEIR OWN CLIENT: an OAuth client for a browser fork
 * can't be shipped in the source -- the "secret" would be public, and every
 * install would share one quota + consent screen. So Cthulhu holds no Google
 * credentials of its own; you create a client in your own Google Cloud project
 * and it stays yours. (For Desktop-app clients Google states the secret "isn't
 * treated as a secret" anyway -- it can't be kept confidential in an installed
 * app -- which is why PKCE is what actually protects the exchange.)
 *
 * STORAGE: the client id/secret and the refresh token live in a private
 * IndexedDB store (DB "cthulhu-gcal"), deliberately NOT in the widget's config
 * object -- widget config is serialized into the saved layout and broadcast to
 * other tabs, so credentials would ride along into anything that touches a
 * layout export. Scope requested is calendar.readonly: this can read your
 * calendars and nothing else.
 * ============================================================================= */
"use strict";

window.CthulhuGCal = (function () {
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const API = "https://www.googleapis.com/calendar/v3";
  /* Two narrow scopes rather than the blanket `calendar` one:
   *   calendar.events               create / edit / delete events
   *   calendar.calendarlist.readonly  list the calendars for the ⚙ picker
   * They genuinely don't overlap -- per Google's reference, events.insert does
   * NOT accept a calendarlist scope and calendarList.list does NOT accept
   * calendar.events -- so asking for only one of them silently breaks either
   * the create buttons or the calendar dropdown. */
  const SCOPE = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ].join(" ");
  const DB = "cthulhu-gcal";
  const STORE = "kv";
  const AUTH_KEY = "auth";
  // Google's consent page can sit open for a while; give up eventually rather
  // than leaving a socket listening for the life of the tab.
  const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

  /* ------------------------------ persistence ------------------------------ */
  function withStore(txMode, fn) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (e) {} };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        let out = null;
        const tx = db.transaction(STORE, txMode);
        const r = fn(tx.objectStore(STORE));
        if (r) r.onsuccess = () => { out = r.result; };
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => { db.close(); resolve(null); };
      };
    });
  }
  const loadAuth = () => withStore("readonly", (s) => s.get(AUTH_KEY)).then((v) => v || {});
  const saveAuth = (v) => withStore("readwrite", (s) => { s.put(v, AUTH_KEY); return null; });

  /* --------------------------------- PKCE ---------------------------------- */
  function b64url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomB64(nBytes) {
    return b64url(crypto.getRandomValues(new Uint8Array(nBytes)));
  }
  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(digest));
  }

  /* --------------------------- loopback redirect --------------------------- */
  /** Listen on 127.0.0.1 for Google's redirect; resolve with its query params.
   *  Returns { redirectUri, done, cancel } -- `done` is the promise. */
  function listenForCallback() {
    const ss = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    ss.init(-1, true, -1); // -1 port = OS-assigned; loopbackOnly = true
    const redirectUri = "http://127.0.0.1:" + ss.port + "/";

    let settle = null;
    let timer = null;
    const done = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const close = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try { ss.close(); } catch (e) {}
    };

    function respond(transport, title, message) {
      try {
        const body =
          "<!doctype html><meta charset=utf-8><title>" + title + "</title>" +
          "<body style=\"font:14px system-ui;padding:40px;background:#1a1a1a;color:#e8e8e8\">" +
          "<h2>" + title + "</h2><p>" + message + "</p>";
        const out = transport.openOutputStream(0, 0, 0);
        const resp =
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
          "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n" + body;
        out.write(resp, resp.length);
        out.close();
      } catch (e) { /* the browser may have already dropped the connection */ }
    }

    ss.asyncListen({
      onSocketAccepted(socket, transport) {
        try {
          const input = transport.openInputStream(0, 0, 0);
          input.QueryInterface(Ci.nsIAsyncInputStream).asyncWait({
            onInputStreamReady(stream) {
              try {
                const sin = Cc["@mozilla.org/scriptableinputstream;1"]
                  .createInstance(Ci.nsIScriptableInputStream);
                sin.init(stream);
                const requestLine = sin.read(sin.available()).split("\r\n")[0];
                const path = requestLine.split(" ")[1] || "";
                const qs = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
                const params = new URLSearchParams(qs);

                if (params.get("error")) {
                  respond(transport, "Not connected",
                    "Google reported: " + params.get("error") + ". You can close this tab.");
                  close();
                  settle.reject(new Error("Google returned: " + params.get("error")));
                  return;
                }
                respond(transport, "Connected",
                  "Cthulhu is now linked to your Google Calendar. You can close this tab.");
                close();
                settle.resolve({ code: params.get("code"), state: params.get("state") });
              } catch (e) {
                close();
                settle.reject(e);
              }
            },
          }, 0, 0, Services.tm.mainThread);
        } catch (e) {
          close();
          settle.reject(e);
        }
      },
      onStopListening() {},
    });

    timer = setTimeout(() => {
      close();
      settle.reject(new Error("Timed out waiting for Google to redirect back"));
    }, CALLBACK_TIMEOUT_MS);

    return { redirectUri, done, cancel: close };
  }

  /* ------------------------------ token plumbing --------------------------- */
  async function postForm(url, fields) {
    const body = new URLSearchParams(fields).toString();
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(
        (data.error_description || data.error || "HTTP " + resp.status) +
        " (from Google's token endpoint)"
      );
    }
    return data;
  }

  /** Run the full interactive consent flow. Resolves once tokens are stored. */
  async function connect() {
    const auth = await loadAuth();
    if (!auth.clientId) throw new Error("Set your Google OAuth client ID first");

    const verifier = randomB64(48);
    const challenge = await challengeFor(verifier);
    const state = randomB64(16);
    const server = listenForCallback();

    const url = AUTH_URL + "?" + new URLSearchParams({
      client_id: auth.clientId,
      redirect_uri: server.redirectUri,
      response_type: "code",
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",  // ask for a refresh token
      prompt: "consent",       // ...and re-issue it even on a repeat connect
    }).toString();

    // Always a NEW tab, never in place: this page has to stay alive to hold the
    // loopback socket and finish the exchange (ctx.openLink would navigate away
    // on an ordinary new tab).
    window.open(url, "_blank");

    let cb;
    try {
      cb = await server.done;
    } catch (e) {
      server.cancel();
      throw e;
    }
    if (cb.state !== state) throw new Error("State mismatch on the OAuth callback -- aborted");

    const tok = await postForm(TOKEN_URL, {
      code: cb.code,
      client_id: auth.clientId,
      ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
      redirect_uri: server.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });

    await saveAuth({
      ...auth,
      refreshToken: tok.refresh_token || auth.refreshToken || null,
      accessToken: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
    });
    if (!tok.refresh_token && !auth.refreshToken) {
      // Without one we'd silently stop working in an hour with no way back.
      throw new Error("Google did not return a refresh token -- try disconnecting and connecting again");
    }
  }

  /** A valid access token, refreshing if the stored one is expired/near-expiry. */
  async function accessToken() {
    const auth = await loadAuth();
    if (!auth.refreshToken) throw new Error("Not connected to Google Calendar");
    // 60s of slack so a request can't die mid-flight on an expiring token.
    if (auth.accessToken && auth.expiresAt && Date.now() < auth.expiresAt - 60000) {
      return auth.accessToken;
    }
    const tok = await postForm(TOKEN_URL, {
      refresh_token: auth.refreshToken,
      client_id: auth.clientId,
      ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
      grant_type: "refresh_token",
    });
    await saveAuth({
      ...auth,
      accessToken: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
    });
    return tok.access_token;
  }

  async function apiRequest(method, path, { params, body } = {}) {
    const token = await accessToken();
    const url = API + path + (params ? "?" + new URLSearchParams(params).toString() : "");
    const init = { method, headers: { Authorization: "Bearer " + token } };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    // 204 (delete) has no body to parse.
    if (resp.status === 204) return null;
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data.error && (data.error.message || data.error)) || "HTTP " + resp.status;
      throw new Error(String(msg));
    }
    return data;
  }
  const apiGet = (path, params) => apiRequest("GET", path, { params });

  /** Raw calendarList entries (keeps `primary`/`accessRole`, which the public
   *  wrapper flattens away but identity + writability checks need). */
  async function calendarListRaw() {
    const data = await apiGet("/users/me/calendarList", {
      minAccessRole: "reader",
      maxResults: "250",
    });
    return data.items || [];
  }

  /* --------------------------------- public -------------------------------- */
  return {
    getAuth: loadAuth,
    async setClient(clientId, clientSecret) {
      const auth = await loadAuth();
      await saveAuth({ ...auth, clientId: clientId || null, clientSecret: clientSecret || null });
    },
    async isConnected() {
      return !!(await loadAuth()).refreshToken;
    },
    connect,
    async disconnect() {
      const auth = await loadAuth();
      // Keep the client id/secret so reconnecting doesn't mean re-entering them.
      await saveAuth({ clientId: auth.clientId, clientSecret: auth.clientSecret });
    },
    /** [{id, summary, primary, canWrite}] of the calendars this account can read. */
    async listCalendars() {
      return (await calendarListRaw()).map((c) => ({
        id: c.id,
        summary: c.summaryOverride || c.summary || c.id,
        primary: !!c.primary,
        // "owner"/"writer" can create+edit; "reader"/"freeBusyReader" cannot.
        canWrite: c.accessRole === "owner" || c.accessRole === "writer",
      }));
    },

    /** The signed-in account's own address -- the primary calendar's id IS the
     *  user's email. Needed to tell "mine" from "theirs" on a shared calendar,
     *  and cached so it isn't refetched on every poll. */
    async getMyEmail() {
      const auth = await loadAuth();
      if (auth.email) return auth.email;
      const primary = (await calendarListRaw()).find((c) => c.primary);
      if (!primary) return null;
      // Re-read rather than spreading the `auth` above: the API call in
      // between may have refreshed (and persisted) the access token, and
      // writing back the stale copy would silently undo that.
      await saveAuth({ ...(await loadAuth()), email: primary.id });
      return primary.id;
    },

    /** Expanded single events between two Dates, ordered by start. */
    async listEvents(calendarId, timeMin, timeMax) {
      const data = await apiGet("/calendars/" + encodeURIComponent(calendarId || "primary") + "/events", {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: "true",   // expand recurring events into instances
        orderBy: "startTime",
        maxResults: "250",
      });
      return data.items || [];
    },

    createEvent(calendarId, body) {
      return apiRequest("POST", "/calendars/" + encodeURIComponent(calendarId || "primary") + "/events",
        { body });
    },
    /** PATCH = partial update, so this can't clobber fields it doesn't send. */
    patchEvent(calendarId, eventId, body) {
      return apiRequest("PATCH",
        "/calendars/" + encodeURIComponent(calendarId || "primary") +
        "/events/" + encodeURIComponent(eventId), { body });
    },
    deleteEvent(calendarId, eventId) {
      return apiRequest("DELETE",
        "/calendars/" + encodeURIComponent(calendarId || "primary") +
        "/events/" + encodeURIComponent(eventId));
    },
  };
})();
