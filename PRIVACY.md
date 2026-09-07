# Privacy

Cthulhu is a personal fork of Firefox ESR. This document lists **every outbound
network request the browser makes beyond the pages you actually visit** — what is
sent, who receives it, why, and how to stop it.

It is meant to be exhaustive and honest, including the parts that are not
flattering. Where something cannot currently be turned off, it says so.

## What was removed

Cthulhu ships these off by **default** (set in
[`src/browser/app/profile/cthulhu.js`](src/browser/app/profile/cthulhu.js) — all
`pref()`, so they remain overridable in `about:config`):

| Area | Prefs |
| --- | --- |
| Telemetry | `toolkit.telemetry.enabled`, `toolkit.telemetry.unified`, `toolkit.telemetry.archive.enabled` |
| Health/data reporting | `datareporting.healthreport.uploadEnabled`, `datareporting.policy.dataSubmissionEnabled` |
| Studies / experiments | `app.shield.optoutstudies.enabled`, `app.normandy.enabled` |
| Pocket & recommendations | `extensions.pocket.enabled`, `browser.discovery.enabled`, `extensions.htmlaboutaddons.recommendations.enabled` |
| Sponsored new-tab content | `browser.newtabpage.activity-stream.showSponsored`, `…showSponsoredTopSites`, `…feeds.section.topstories` |
| Firefox Accounts / Sync | `identity.fxaccounts.enabled` |

**No analytics, crash reporting, or usage data is collected by this project.**
There is no server that belongs to this project collecting anything about you.

---

## Outbound requests

| # | Endpoint | When | Off switch |
| --- | --- | --- | --- |
| 1 | The linked site itself, then `icons.duckduckgo.com` | Homepage quick-links, folder widget, side panels | `cthulhu.favicons.remote=false` |
| 2 | `api.open-meteo.com` | Ambient weather theming | `cthulhu.ambient.weather.enabled=false` |
| 3 | Google Calendar / OAuth | Only if you connect a calendar | Don't connect / Disconnect |
| 4 | `eventide-03.github.io` → `github.com` | Update check at every startup, then periodically | `DisableAppUpdate` policy |
| 5 | Your feature-request relay | Only when you send one (toolbar button, or clicking the Rishi pet) | Don't use the feature |
| 6 | `eventide-03.github.io`, `github.com` | After an update, and About-dialog links | `startup.homepage_override_url=""` |

### 1. Favicon lookups — the site itself, then DuckDuckGo

**Sent:** the **domain name** of each link — e.g. `github.com`. Not the full URL,
not the path, and no identifier for you beyond your IP address and the normal
headers any request carries.

**To whom, in this order:**

1. `https://<host>/favicon.ico` — **the linked site itself, tried first**
2. `https://icons.duckduckgo.com/ip3/<host>.ico` — only if the site has none
3. Otherwise the widget keeps its placeholder icon

**Why the site first:** it is the one party that already knows you are
interested in it. This is *your* quick link, one click away from a visit, so
asking it directly means **no third party learns the domain at all**. Sites that
serve no `/favicon.ico` fall through to DuckDuckGo, which is a favicon proxy that
does not profile requests.

**Why:** to show a real icon on each tile instead of a placeholder.

**Where:** the **quick-links widget**, the **folder widget**, and the **side
panels** — three separate call sites, all using the same order.

> **Changed in 1.0.5.** Google's `s2/favicons` service used to be **first** in
> that list, which meant **Google normally received the domain list of your
> quick links, folders and side panels**. It has been removed outright. If you
> are reading this against an older build, that is what it did.

Results are cached per session, so it is one request per host per browser
session, not one per page load. Each attempt is capped at 3 seconds so a slow or
dead host cannot stall its tile.

**How to turn it off:** set **`cthulhu.favicons.remote = false`** in
`about:config`. Step 2 then disappears and nothing but the linked site itself is
ever contacted. Also still true:

- Set a **custom image** on a quick link (stored as a `data:` URL) — that path
  skips the network fetch entirely.
- Remove the quick-links / folder widgets and the side panels you don't use.

### 2. Weather — `api.open-meteo.com`

**Sent:** a latitude and longitude, in the query string:

```
https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lng>&current=weather_code
```

Nothing else — no account, no API key, no identifier.

**Which coordinates**, in priority order:

1. `cthulhu.ambient.latitude` / `cthulhu.ambient.longitude`, if you set them
2. Device geolocation — **only** if `cthulhu.ambient.geolocation=true` (default `false`)
3. Otherwise a **hard-coded placeholder** (New York City), which is not your location

So by default this reveals no real location. It reveals your actual position only
if you explicitly set the coordinate prefs or opt into geolocation.

**Why:** to swap the ambient theme palette and overlays between
clear/cloudy/rain/snow/storm.

**Frequency:** at most once every 30 minutes; the result is cached in a pref.

**How to turn it off:**

```
cthulhu.ambient.weather.enabled = false
```

No request is made at all, and theming falls back to time of day only.
**Time-of-day theming needs no network** — sunrise/sunset is computed locally
from a solar formula. Note that with geolocation enabled, coordinates may still
be *acquired* locally for that calculation; they are simply never transmitted.

> **Current state:** the ambient theme is pinned to a fixed night palette
> (`LOCKED_NIGHT = true` in `ambient-theme.js`) pending final theme colours, so
> **no weather request happens at all right now**, regardless of this pref.

### 3. Google Calendar — opt-in only

**Nothing is sent unless you explicitly connect a calendar.** Disconnected, the
widget makes no requests.

**If you connect:**

| Endpoint | Purpose | Sent |
| --- | --- | --- |
| `accounts.google.com` | Consent screen, opened in a normal tab | Your Google sign-in, to Google |
| `oauth2.googleapis.com/token` | Exchange/refresh tokens | Your OAuth client ID/secret, auth code or refresh token |
| `www.googleapis.com/calendar/v3/…` | Read and modify events | Calendar and event data |

**Why:** to show today's events and let you create, complete, and delete them.

**Credentials** — your OAuth client ID/secret and refresh token are stored in a
**private IndexedDB database on your machine** and are never committed to this
repository or sent anywhere except Google. The flow uses **PKCE (S256)** with a
**loopback redirect** (`http://127.0.0.1:<random-port>/`), which is the standard
for installed apps. You supply your own OAuth client — this project does not ship
one and has no shared credential.

**Frequency:** polls every 5–15 minutes while connected (configurable).

**How to turn it off:** never connect, or use **⚙ → Disconnect**, which drops the
stored tokens.

### 4. Update checks — `eventide-03.github.io`

**Sent:** a request for one static XML file, and nothing else:

```
https://eventide-03.github.io/Cthulhu/updates/release/<BUILD_TARGET>/update.xml
```

`<BUILD_TARGET>` is your operating system and processor architecture — for
example `WINNT_x86_64-msvc-x64` or `Darwin_aarch64-gcc3`. It is in the path
because it **selects the file**: a Windows machine must not be offered a macOS
update. Beyond that, only your IP address and the headers any HTTPS request
carries. GitHub host the file, so GitHub see those.

**What is deliberately NOT sent.** Firefox's stock update URL carries a detailed
fingerprint — exact version, a 14-digit build timestamp, exact OS build number,
locale, distribution, and `%SYSTEM_CAPABILITIES%`, which expands to
`ISET:<cpu-instruction-set>,MEM:<memory-in-MB>`. Cthulhu sends none of it.

Earlier builds moved those fields into the query string, where GitHub Pages
ignores them. **They were removed outright in 1.0.5**: a parameter that nobody
can read is not a feature, it is a fingerprint. Pages serves a static file and
gives this project no request log, so nothing was ever gained by sending them.

This works because **the version comparison happens on your machine**. The
manifest always advertises the newest release, and your browser decides locally
whether that is newer than what it is running. The server is never told what you
have installed.

**When:** at every startup, and every 6 hours while the browser stays open. On
Windows there may additionally be a scheduled task that checks roughly every
7 hours while the browser is closed; it is only registered if you installed
Cthulhu for all users as an administrator.

**Not anonymous.** This is an ordinary request, so a cookie for
`eventide-03.github.io` would be attached if one existed. GitHub Pages does not
set cookies on static sites, so in practice there is none — but the request is
not specially isolated, and this document would rather say so.

**Downloading** an update then fetches the package from
`github.com/Eventide-03/Cthulhu/releases/…`, which necessarily tells GitHub
which version you are moving to.

**How to turn it off.** `app.update.auto = false` stops updates from being
**downloaded** automatically; it does **not** stop the check. The only complete
off switch is the enterprise policy, which needs a `policies.json` file beside
the application:

```json
{ "policies": { "DisableAppUpdate": true } }
```

Narrower options, in `about:config`: `app.update.checkInstallTime = false`
disables the startup check only, and
`app.update.background.scheduling.enabled = false` disables the Windows
scheduled task only.

### 5. Feature-request relay — only on explicit submission

**Nothing is sent unless you type a feature request and press Send.** There is
no background traffic to this endpoint, and no telemetry rides along with it.

**Sent:** the message you typed, the name you optionally typed, your Cthulhu
version, and a coarse platform string (e.g. `Windows (x86_64)` or
`macOS (aarch64)`). Nothing else — no page you were on, no profile identifier,
no device id.

**To whom:** a small [Cloudflare Worker](../relay/README.md) run by this project,
which forwards the message to a private Discord channel. Cloudflare sees your IP
(it uses it for rate limiting); Discord sees only what the Worker forwards.

**Why:** so you can ask for features without needing a GitHub account.

> **Why a relay rather than posting to Discord directly:** the Discord webhook
> URL would otherwise have to ship inside the browser, where anyone could pull
> it out of the binary and post to the channel. The webhook exists only as a
> Cloudflare secret and is never in the browser or this repository.

**How to turn it off:** don't use the feature. If you want to be certain, clear
the `cthulhu.relay.url` pref in `about:config` — the button and widget then
refuse to send at all. Removing the `feature-request` module
(`cthulhu.module.feature-request.enabled = false`) hides the toolbar button
entirely.

### 6. Release notes and post-update page

**Sent:** an ordinary page request. The post-update "what's new" tab loads
`eventide-03.github.io/Cthulhu/whatsnew/<version>/`, which does tell GitHub the
version you just updated to. The About-dialog and update-prompt links go to this
project's releases page on `github.com`. No identifier beyond your IP and normal
headers.

**When:** after an update completes (a "what's new" tab), and if you click the
release-notes link in the About dialog or an update prompt.

**Why:** to show you what changed.

> **Note:** these URLs come from a pref file that Surfer — the Zen Browser build
> tool this project uses — generates with **`zen-browser.app` URLs hardcoded**.
> Left alone, a branded build would send users to Zen Browser's site from the
> About dialog and after every update. Cthulhu overrides all of them in
> `cthulhu.js` to point at this project's own releases page instead.

**How to turn it off:** set `startup.homepage_override_url` to an empty string;
the About-dialog links are only followed if you click them.

---

## Things that look like ours but are your own browsing

- **Search widget** — submitting a search navigates to DuckDuckGo
  (`https://duckduckgo.com/?q=…`) in a tab. Configurable per widget; nothing is
  sent until you press Enter.
- **Side panels** — Discord, Instagram, and Apple Music load in embedded browser
  views. These are ordinary web sessions with those services, with their own
  cookies and their own privacy policies. They load only when you open the panel,
  but note that **panels stay loaded until the browser exits**, so a service can
  keep a connection open in the background after you close the panel.

## What Cthulhu does *not* change

**Cthulhu does not disable Firefox's own built-in network features**, which
remain at upstream defaults. These are not this project's requests, but they are
still requests your browser makes, and an honest privacy document should say so:

- **Safe Browsing** — downloads blocklists from Google, and may check some
  downloads (`browser.safebrowsing.*`)
- **Remote Settings** — periodic config/blocklist sync from
  `firefox.settings.services.mozilla.com` (`services.settings.*`)
- **Add-on blocklist** and extension update checks (AMO)
- **Captive-portal detection** and **connectivity checks** (`detectportal.firefox.com`)
- **Certificate revocation** (OCSP / CRLite)
- **Region lookup** (`browser.region.*`)

If you want these off too, they are all `about:config` preferences —
[arkenfox](https://github.com/arkenfox/user.js) documents them thoroughly.
Turning some off (Safe Browsing, OCSP) **trades away real security protection**,
so decide deliberately.

## Preference quick reference

| Preference | Default | Effect |
| --- | --- | --- |
| `cthulhu.ambient.weather.enabled` | `true` | `false` → no Open-Meteo request; no coordinates leave the machine |
| `cthulhu.ambient.geolocation` | `false` | `true` → allows device geolocation as a location source |
| `cthulhu.ambient.latitude` / `.longitude` | unset | Explicit coordinates; avoids geolocation entirely |
| `app.update.auto` | `true` | `false` → no automatic update checks |
| `cthulhu.relay.url` | *(set at build)* | Empty → the feature-request form cannot send anything |

---

*If you find an outbound request that is not documented here, that is a bug —
please report it. See [SECURITY.md](SECURITY.md).*
