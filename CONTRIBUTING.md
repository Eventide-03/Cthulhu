# CONTRIBUTING — notes to future me

Everything here assumes the working loop: edit `src/`, `surfer import`,
`surfer build --skip-patch-check`, test, commit. Never commit `engine/`.

## Add a chrome feature module

```
src/theme/content/modules/<id>/
  manifest.json      {"id":"<id>","enabled":true,"mount":"browser-window","css":"<id>.css","js":"<id>.js"}
  <id>.js            IIFE, runs in the browser-window global (Services etc. available)
  <id>.css           theme.css tokens only — no hardcoded colors
  assets/            art (see below)
```

Then — all three, every time:

1. Add `"<id>"` to `modules/index.json`.
2. **Add EVERY file to `src/theme/jar.mn` — it does not glob.** A file missing
   here is silently absent from the build. This has bitten before.
3. Toggle pref is automatic: `cthulhu.module.<id>.enabled`.

Prompt pattern that works (paste to Claude):

> Add a feature module `<id>` on the existing module pattern
> (src/theme/content/modules/README.md): [what it does]. Register it in
> index.json AND jar.mn, use theme variables, leave an ART SLOT for [icon],
> platform-neutral, verify with Marionette.

## Add a homepage widget

```
src/theme/content/newtab/widgets/<id>/<id>.js   → calls CthulhuWidgets.register({...})
```

Register in `widgets/index.json` **and** `jar.mn` (same trap as above).

**⚠️ Build every control with `createElement`.** `about:cthulhu` runs with the
system principal; `innerHTML` there passes through a sanitizer that **silently
drops `<button>`, `<input>`, `<select>`**. Inert markup via innerHTML is fine.
Full `ctx` API: `newtab/widgets/README.md`.

## Art assets

- Live in the module's/widget's `assets/`; referenced via
  `chrome://cthulhu/content/...` (modules) or `ctx.assetUrl()` (widgets).
- Aseprite: export **PNG spritesheet + JSON (Array)**; the sprite helper
  (`CthulhuSprite.fromAseprite`) reads frame timing from the JSON.
- Pixel art renders with `image-rendering: pixelated`; ship 1x sizes the UI
  expects (16px toolbar icons, +32px for HiDPI) and keep filenames stable.
- Placeholders are marked `ART SLOT` in comments — grep for that to find every
  slot awaiting real art.

## How the pipeline fits together

```
src/ (patches + chrome layer)
  └─ surfer import → engine/ (Firefox ESR + our changes) → surfer build
tag vX.Y.Z → CI: build mac(universal)+win → sign/notarize (if secrets) → dmg/exe
  → complete MARs → signmar + verify → GitHub Release → update manifests + whatsnew → Pages
clients: app.update checks Pages manifest → downloads MAR from Releases → verifies
  against the cert baked in src/toolkit/mozapps/update/updater/*.der
```

Details: RELEASE.md (loop), docs/updates/README.md (update service),
relay/README.md (feature-request relay).

## Secrets and where they live (names only — values never leave their vault)

| Name | Where | For |
| --- | --- | --- |
| `MAR_SIGNING_DB_B64` | GitHub Actions secret | Signs update MARs. **Required for every release.** Original NSS DB: `~/.cthulhu-mar-signing/` (outside the repo; back it up — lose it and installed copies can never update again) |
| `DISCORD_WEBHOOK_URL` | **Cloudflare Worker** secret (`wrangler secret put`) | Feature-request relay → Discord. Never in the repo or the browser |
| `MACOS_CERT_P12` / `MACOS_CERT_PASSWORD` / `MACOS_SIGN_IDENTITY` | GitHub Actions secrets (future) | Developer ID app signing |
| `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_PASSWORD` | GitHub Actions secrets (future) | Notarization |
| `UPDATE_MANIFEST_URL` / `RELAY_URL` / `RELAY_EXPECT_STATUS` | GitHub Actions **variables** (not secret) | endpoint-health watchdog targets |

Rules that keep the public repo safe: author email is the GitHub noreply
(repo-local `user.email` is already set); never commit absolute `/Users/...`
paths or anything key-shaped (`.gitignore` backstops this); when in doubt, grep
staged content before pushing.
