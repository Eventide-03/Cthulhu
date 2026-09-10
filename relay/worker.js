/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Cthulhu relay: feature requests to Discord, and Rishi's shared state.
 *
 * WHY THIS EXISTS: the Discord webhook URL must never ship inside the browser.
 * Anyone can pull strings out of a binary, and this repo is public -- a leaked
 * webhook lets strangers post into the channel until it is rotated. The browser
 * therefore knows only this Worker's public URL; the webhook lives in
 * env.DISCORD_WEBHOOK_URL, a Cloudflare secret, and never leaves the edge.
 *
 * The same reasoning gives the Worker its second job. Rishi's mood is meant
 * to be seen in BOTH browsers, which needs a place to hold the value and a way
 * to prove who may change it. The value lives in KV (env.STATE); the proof is
 * env.ADMIN_TOKEN, a secret the owner sets here and types into the browser's
 * admin panel. It, too, is never in the binary or the repo.
 *
 * Contract:
 *   POST /        { message, name?, version?, platform? }  ->  { ok: true }
 *   GET  /rishi                                            ->  { ok, mood, updatedAt }
 *   PUT  /rishi   { mood }  + Authorization: Bearer <ADMIN_TOKEN>
 *                                                          ->  { ok, mood, updatedAt }
 *   anything else                                          ->  { ok: false, error }
 */

const LIMITS = {
  body: 8 * 1024, // hard cap on the raw request body
  message: 1500, // Discord's content cap is 2000; leave room for the wrapper
  name: 80,
  version: 40,
  platform: 60,
  mood: 60, // must match MOOD_MAX in the pet widget
};
const STATE_KEY = "rishi";

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
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization, " + CLIENT_HEADER,
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
      "cache-control": "no-store",
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

/** Constant-time check of "Authorization: Bearer <token>" against the secret. */
function bearerOk(header, secret) {
  if (!header || !secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const a = new TextEncoder().encode(m[1].trim());
  const b = new TextEncoder().encode(secret);
  if (a.length !== b.length) return false;
  if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function limit(binding, key) {
  if (!binding) return true;
  const { success } = await binding.limit({ key });
  return success;
}

async function readJson(request, headers) {
  const raw = await request.text();
  if (raw.length > LIMITS.body) return { error: json({ ok: false, error: "Request too large" }, 413, headers) };
  if (raw.length === 0) return { payload: {} };
  try {
    const payload = JSON.parse(raw);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { error: json({ ok: false, error: "Malformed payload" }, 400, headers) };
    }
    return { payload };
  } catch (e) {
    return { error: json({ ok: false, error: "Malformed JSON" }, 400, headers) };
  }
}

/* ------------------------------ Rishi's state ------------------------------ */
async function readState(env) {
  const v = await env.STATE.get(STATE_KEY, "json");
  return {
    mood: typeof v?.mood === "string" ? v.mood : "",
    updatedAt: typeof v?.updatedAt === "number" ? v.updatedAt : 0,
  };
}

async function handleRishi(request, env, headers) {
  if (!env.STATE) {
    console.error("STATE KV binding is not configured");
    return json({ ok: false, error: "State store not configured" }, 503, headers);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (request.method === "GET") {
    if (!(await limit(env.READ_LIMITER, ip))) {
      return json({ ok: false, error: "Too many requests" }, 429, { ...headers, "Retry-After": "60" });
    }
    return json({ ok: true, ...(await readState(env)) }, 200, headers);
  }

  if (request.method === "PUT") {
    // Writes are rare and precious; the strict limiter is fine for them, and
    // it also slows a token guesser to three tries a minute per address.
    if (!(await limit(env.REQUEST_LIMITER, ip))) {
      return json({ ok: false, error: "Too many requests" }, 429, { ...headers, "Retry-After": "60" });
    }
    if (!env.ADMIN_TOKEN) {
      console.error("ADMIN_TOKEN secret is not set");
      return json({ ok: false, error: "Admin token not configured on the relay" }, 503, headers);
    }
    if (!bearerOk(request.headers.get("Authorization"), env.ADMIN_TOKEN)) {
      return json({ ok: false, error: "Not authorised" }, 401, headers);
    }
    const { payload, error } = await readJson(request, headers);
    if (error) return error;
    const current = await readState(env);
    const next = { ...current };
    if ("mood" in payload) next.mood = sanitize(payload.mood, LIMITS.mood);
    if (next.mood !== current.mood) {
      next.updatedAt = Date.now();
      await env.STATE.put(STATE_KEY, JSON.stringify(next));
    }
    return json({ ok: true, ...next }, 200, headers);
  }

  return json({ ok: false, error: "Method not allowed" }, 405, headers);
}

/* ----------------------------- feature requests ---------------------------- */
async function handleFeatureRequest(request, env, headers) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, headers);
  }

  // ---- rate limit, per client IP -----------------------------------------
  // CF-Connecting-IP is set by Cloudflare itself and cannot be spoofed by the
  // caller. The binding is per-datacentre and eventually consistent -- it is
  // burst protection, not accounting. See relay/README.md.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await limit(env.REQUEST_LIMITER, ip))) {
    return json(
      { ok: false, error: "Too many requests. Please wait a minute and try again." },
      429,
      { ...headers, "Retry-After": "60" }
    );
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
      { ok: false, error: retryable ? "Discord is busy, try again shortly" : "Delivery failed" },
      retryable ? 503 : 502,
      headers
    );
  }

  return json({ ok: true }, 200, headers);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const { allowed, headers } = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers });
    }
    if (!allowed) {
      return json({ ok: false, error: "Origin not allowed" }, 403, headers);
    }
    if (!request.headers.get(CLIENT_HEADER)) {
      return json({ ok: false, error: "Missing client header" }, 403, headers);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path === "/rishi") return handleRishi(request, env, headers);
    if (path === "/") return handleFeatureRequest(request, env, headers);
    return json({ ok: false, error: "Not found" }, 404, headers);
  },
};
