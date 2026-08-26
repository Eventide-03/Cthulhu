# Feature-request relay

A tiny Cloudflare Worker that accepts a feature request from the browser and
forwards it to a Discord webhook.

## Why a relay at all

**The webhook URL must never ship inside the browser.** Strings are trivially
recoverable from a binary, and this repo is public — a leaked webhook lets
anyone post into the channel until it is rotated. So the browser knows only this
Worker's public URL. The webhook lives in a Cloudflare secret and never leaves
the edge.

## What it does

`POST /` with `{ message, name?, version?, platform? }` → `{ ok: true }`.

| Protection | How |
| --- | --- |
| Size | Body capped at 8 KB; message 1500 chars, name 80, version 40, platform 60 |
| Empty / malformed | Rejected with 400 before anything is forwarded |
| Mention abuse | `@everyone`/`@here` defanged, role/user/channel mentions stripped, **and** `allowed_mentions:{parse:[]}` disables every mention server-side |
| Flooding | Per-IP rate limit on `CF-Connecting-IP` (unspoofable — Cloudflare sets it) |
| Cross-site abuse | Origin allow-list + a required `X-Cthulhu-Client` header that forces a preflight |
| Secret leakage | Upstream error bodies are logged, never echoed to the caller |

### On CORS, honestly

CORS is enforced by *browsers*, so it cannot stop `curl`. It is not the security
boundary here — the rate limit and the validation are. What the origin
allow-list plus the custom header genuinely buys is that a random web page
cannot silently POST to this relay from a visitor's browser, because the custom
header forces a preflight that we refuse.

`about:cthulhu` runs with the system principal, so its requests carry no
`Origin` (or `null`). That is why "no origin" is allowed while real foreign web
origins are rejected.

### On the rate limit, honestly

Cloudflare's rate-limiting binding is **per-datacentre and eventually
consistent** — Cloudflare describes it as "permissive… intentionally designed to
not be used as an accurate accounting system". It is burst protection, not a
quota. Someone determined, spread across many exit nodes, could exceed it. For a
hobby project's feature-request box that is the right trade; if it is ever
abused, rotate the webhook and tighten `limit`.

## Deploy

**One-time setup**

1. Install Wrangler (needs **4.36.0+** for the rate-limit binding):
   ```bash
   npm install -g wrangler@latest
   ```
2. Log in — opens a browser to authorise:
   ```bash
   wrangler login
   ```
3. Deploy from this directory:
   ```bash
   cd relay && wrangler deploy
   ```
   Note the URL it prints: `https://cthulhu-relay.<your-subdomain>.workers.dev`.

4. Set the webhook as a **secret** (it is prompted for, never passed as an
   argument, so it does not land in your shell history):
   ```bash
   wrangler secret put DISCORD_WEBHOOK_URL
   ```
   Paste your Discord webhook URL when prompted.

5. Point the browser at it — set this pref default in
   `src/browser/app/profile/cthulhu.js` (or per-user in `about:config`):
   ```
   cthulhu.relay.url = https://cthulhu-relay.<your-subdomain>.workers.dev
   ```

**Redeploying after a code change**

```bash
cd relay && wrangler deploy
```

Secrets persist across deploys — you only set them again to rotate.

## Verify it works

```bash
curl -i -X POST https://cthulhu-relay.<your-subdomain>.workers.dev \
  -H 'content-type: application/json' \
  -H 'x-cthulhu-client: 1' \
  -d '{"message":"hello from curl","name":"me","version":"1.0.0","platform":"macOS"}'
```

Expect `HTTP/2 200` and `{"ok":true}`, and a message in the Discord channel.
Run it four times in a minute and the fourth should return `429`.

## Rotating the webhook

If the webhook is ever abused: delete it in Discord (Server Settings →
Integrations → Webhooks), create a new one, then
`wrangler secret put DISCORD_WEBHOOK_URL` again. No browser update needed —
clients only know the relay URL.

## Local development

```bash
cd relay
echo 'DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."' > .dev.vars
wrangler dev
```

`.dev.vars` is gitignored. **Never commit it.**
