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
| 1 | `www.google.com` → `icons.duckduckgo.com` | Homepage quick-links, folder widget, side panels | ⚠️ none yet |
| 2 | `api.open-meteo.com` | Ambient weather theming | `cthulhu.ambient.weather.enabled=false` |
| 3 | Google Calendar / OAuth | Only if you connect a calendar | Don't connect / Disconnect |
| 4 | Update endpoint | Update checks | `app.update.auto=false` |
| 5 | Your feature-request relay | Only when you submit a request | Don't use the feature |
| 6 | `github.com` | After an update, and About-dialog links | `startup.homepage_override_url=""` |

### 1. Favicon lookups — ⚠️ Google first, then DuckDuckGo

**Sent:** the **domain name** of each link — e.g. `github.com`. Not the full URL,
not the path, and no identifier for you beyond your IP address and the normal
headers any request carries.

**To whom, in this order:**

1. `https://www.google.com/s2/favicons?domain=<host>&sz=64` — **tried first**
2. `https://icons.duckduckgo.com/ip3/<host>.ico` — only if Google fails
3. `https://<host>/favicon.ico` — only if both fail

**Why:** to show a real icon on each tile instead of a placeholder.

**Where:** the **quick-links widget**, the **folder widget**, and the **side
panels** — three separate call sites, all using the same order.

> **Be aware:** because Google is the first source, **Google normally receives the
> domain list of your quick links, folders, and side panels** — not DuckDuckGo.
> Results are cached per session, so it is one request per host per browser
> session, not one per page load.

**How to turn it off:** there is **no preference for this yet.** Current
workarounds:

- Set a **custom image** on a quick link (stored as a `data:` URL) — that path
  skips the network fetch entirely.
- Remove the quick-links / folder widgets and the side panels you don't use.

*A pref to disable remote favicon lookups (falling back to placeholders, or to
the site's own `/favicon.ico` only) would close this gap and is worth adding.*

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

### 4. Update checks — ⚠️ currently points at Mozilla

**What would be sent** — the update URL template embeds a detailed system
fingerprint:

```
…/update/6/%PRODUCT%/%VERSION%/%BUILD_ID%/%BUILD_TARGET%/%LOCALE%/%CHANNEL%/%OS_VERSION%/%SYSTEM_CAPABILITIES%/%DISTRIBUTION%/%DISTRIBUTION_VERSION%/update.xml
```

That is: product name, version, build ID, OS and CPU architecture, locale,
update channel, OS version, distribution — and `%SYSTEM_CAPABILITIES%`, which
expands to **`ISET:<cpu-instruction-set>,MEM:<memory-in-MB>`**.

> **Known issue — the current build is configured to send this to
> `aus5.mozilla.org`, Mozilla's update service.** The intended endpoint is this
> project's own host, but the branding step that rewrites the URL has never run,
> so the compiled-in default survived. The updater is enabled
> (`--enable-updater`), so a build in this state would contact Mozilla on its
> update check. **This should be fixed before any public release.**
>
> The intended replacement is
> `https://<update-host>/updates/browser/%BUILD_TARGET%/%CHANNEL%/update.xml`,
> which sends only platform and channel. The configured host is still the
> `localhost:7648` placeholder, so **there is no working update service yet** —
> see [SECURITY.md](SECURITY.md).

**How to turn it off:** set `app.update.auto = false`, and
`app.update.background.scheduling.enabled = false`, in `about:config`.

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

### 6. Release notes and post-update page — `github.com`

**Sent:** an ordinary page request to this project's GitHub releases page. No
identifier beyond your IP and normal headers.

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
