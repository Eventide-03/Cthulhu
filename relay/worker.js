/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Cthulhu feature-request relay.
 *
 * WHY THIS EXISTS: the Discord webhook URL must never ship inside the browser.
 * Anyone can pull strings out of a binary, and this repo is public -- a leaked
 * webhook lets strangers post into the channel until it is rotated. The browser
 * therefore knows only this Worker's public URL; the webhook lives in
 * env.DISCORD_WEBHOOK_URL, a Cloudflare secret, and never leaves the edge.
 *
 * Contract:
 *   POST { message, name?, version?, platform? }  ->  { ok: true }
 *                                                 ->  { ok: false, error }
 */

const LIMITS = {
  body: 8 * 1024, // hard cap on the raw request body
  message: 1500, // Discord's content cap is 2000; leave room for the wrapper
  name: 80,
  version: 40,
  platform: 60,
};

// about:cthulhu runs with the system principal, so its fetches carry either no
// Origin or "null". Real web pages always send a real Origin, which is what we
// want to turn away -- so the allow-list is "our own pages, or no origin at all".
const ALLOWED_ORIGINS = new Set(["null", "https://eventide-03.github.io"]);

// CORS cannot authenticate a client (curl sends whatever it likes), so it is not
// the security boundary -- the rate limit and the validation below are. What it
// DOES buy: a random web page cannot quietly POST here from a visitor's browser,
// because this custom header forces a preflight that we then refuse.
const CLIENT_HEADER = "x-cthulhu-client";

// Control characters (keeping \n and \t) and zero-width / line-separator
// characters. Written as escapes so the source stays pure ASCII.
const STRIP_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;
const ZWSP = "\u200B";

function cors(origin) {
  const allowed = origin === null || ALLOWED_ORIGINS.has(origin);
  return {
    allowed,
    headers: {
      "Access-Control-Allow-Origin": allowed ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, " + CLIENT_HEADER,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

/**
 * Strip anything that could ping a channel, plus control characters.
 *
 * Defence in depth only -- the request to Discord also sets
 * allowed_mentions:{parse:[]}, which disables every mention server-side even if
 * something slips through here. Belt and braces, because a relay that can be
 * made to @everyone is a relay that gets abused once and then deleted.
 */
function sanitize(input, max) {
  return String(input == null ? "" : input)
    .normalize("NFC")
    .replace(STRIP_RE, "")
    // @everyone / @here in any casing -> broken with a zero-width space
    .replace(/@(everyone|here)\b/gi, "@" + ZWSP + "$1")
    // role <@&1234>, user <@1234> / <@!1234>, channel <#1234>
    .replace(/<@[!&]?\d+>/g, "[mention removed]")
    .replace(/<#\d+>/g, "[channel removed]")
    // collapse absurd runs of newlines so one request cannot flood the channel
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const { allowed, headers } = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, headers);
    }
    if (!allowed) {
      return json({ ok: false, error: "Origin not allowed" }, 403, headers);
    }
    if (!request.headers.get(CLIENT_HEADER)) {
      return json({ ok: false, error: "Missing client header" }, 403, headers);
    }

    // ---- rate limit, per client IP -----------------------------------------
    // CF-Connecting-IP is set by Cloudflare itself and cannot be spoofed by the
    // caller. The binding is per-datacentre and eventually consistent -- it is
    // burst protection, not accounting. See relay/README.md.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.REQUEST_LIMITER) {
      const { success } = await env.REQUEST_LIMITER.limit({ key: ip });
      if (!success) {
        return json(
          {
            ok: false,
            error: "Too many requests. Please wait a minute and try again.",
          },
          429,
          { ...headers, "Retry-After": "60" }
        );
      }
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      // Never echo configuration detail back to the caller.
      console.error("DISCORD_WEBHOOK_URL secret is not set");
      return json({ ok: false, error: "Relay is not configured" }, 503, headers);
    }

    // ---- parse + validate ---------------------------------------------------
    const raw = await request.text();
    if (raw.length === 0) {
      return json({ ok: false, error: "Empty request" }, 400, headers);
    }
    if (raw.length > LIMITS.body) {
      return json({ ok: false, error: "Request too large" }, 413, headers);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return json({ ok: false, error: "Malformed JSON" }, 400, headers);
    }
    if (typeof payload !== "object" || payload === null) {
      return json({ ok: false, error: "Malformed payload" }, 400, headers);
    }

    const message = sanitize(payload.message, LIMITS.message);
    if (!message) {
      return json({ ok: false, error: "Message is empty" }, 400, headers);
    }

    const name = sanitize(payload.name, LIMITS.name);
    const version = sanitize(payload.version, LIMITS.version);
    const platform = sanitize(payload.platform, LIMITS.platform);

    // ---- forward ------------------------------------------------------------
    const fields = [];
    if (version) fields.push({ name: "Version", value: version, inline: true });
    if (platform) fields.push({ name: "Platform", value: platform, inline: true });

    const discord = {
      username: "Cthulhu Feature Requests",
      // Disables every mention type server-side regardless of content.
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Feature request",
          description: message,
          color: 0x5ad1b0,
          author: name ? { name: name } : undefined,
          fields: fields.length ? fields : undefined,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    let resp;
    try {
      resp = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(discord),
      });
    } catch (e) {
      console.error("Discord request failed:", e);
      return json({ ok: false, error: "Could not reach Discord" }, 502, headers);
    }

    if (!resp.ok) {
      // Log the detail; return something generic. The upstream body can contain
      // the webhook id, which must never be echoed to the caller.
      let detail = "";
      try {
        detail = await resp.text();
      } catch (e) {
        /* ignore */
      }
      console.error("Discord returned", resp.status, detail);
      const retryable = resp.status === 429 || resp.status >= 500;
      return json(
        {
          ok: false,
          error: retryable
            ? "Discord is busy, try again shortly"
            : "Delivery failed",
        },
        retryable ? 503 : 502,
        headers
      );
    }

    return json({ ok: true }, 200, headers);
  },
};
