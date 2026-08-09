# Side panels

One toolbar row, docked left of the extensions button: three service toggles
(Discord, Instagram, Apple Music) plus a "Now Playing" squircle (~135×25px).
Both live in the toolbar -- always visible, whether or not anything is open --
not inside the sidebar itself, which only exists once a service is toggled
on. Toggling a service opens a right-hand, resizable sidebar hosting that
service as a real browser view. Clicking the squircle instead opens a
dropdown player (a real popup, not the sidebar) with transport controls,
a progress bar, Apple Music browse shortcuts, and a search bar.

## Why real `<browser>` views, not iframes

Each service loads in a genuine, remote, content-type `<browser>` element --
the same mechanism Firefox itself uses to host a WebExtension's
`sidebar_action` page (see `webext-panels.js` upstream). This is not an
`<iframe>` embedding the site inside a page, and it is not a reimplementation
of any of these services' functionality: it's their own official web app,
running as its own top-level browsing context, exactly as if you'd opened it
in a tab. That matters for two reasons:

- Discord/Instagram/Apple Music can (and in some cases do) set
  `X-Frame-Options`/`frame-ancestors` to block iframe embedding entirely; a
  real `<browser>` isn't a framed subresource, so it isn't affected.
- It stays ToS-safe: we're hosting their actual client, not building a
  competing one.

## Lazy load, then stay loaded until powered off

A service's `<browser>` is created the first time its toggle button is
clicked -- never eagerly. Once created, it deliberately **stays alive** even
after switching to another service or closing the sidebar with the ×
button -- exactly like leaving a real app running in the background (its
websocket keeps receiving events, its own JS keeps running). The × button
only hides the sidebar; it never tears anything down.

The only way to actually shut a panel down -- discard its `<browser>`, end
its content process, stop it costing anything -- is the power button in its
header, opposite the ×. "Discard" there means removing the `<browser>` from
the DOM, which tears down its content process via
`browser-custom-element.mjs`'s own `disconnectedCallback` -> `destroy()`, not
just hiding it. So the "zero background cost" guarantee holds for any panel
that's never been opened, or that's been explicitly powered off -- an
opened-and-left-running panel is a deliberate choice to keep it live, not an
oversight.

## Web Notifications

`toolkit/modules/PopupNotifications.sys.mjs` only shows a permission
doorhanger (including the Notification-permission prompt) for
`gBrowser.selectedBrowser`. Our panel browsers are never a tab, so by default
their prompts are silently dropped. Fixed at the source with a small,
targeted patch (`src/toolkit/modules/PopupNotifications-sys-mjs.patch`) that
also treats a browser marked `[cthulhu-sidepanel-active]` as active -- an
attribute this module sets on exactly the currently-VISIBLE panel browser
(a backgrounded, still-running panel doesn't get permission-prompt anchoring,
since that prompt is only ever expected the first time you open a service,
which is necessarily while it's visible).
The result: opening a service for the first time surfaces the normal
"example.com wants to send notifications" prompt like it would in a tab.

## Unread badges

Each toggle button shows a small red dot (`--notify` in `theme.css`) when a
powered-on, backgrounded service has unread activity. Detected via the
`pagetitlechanged` event on that service's `<browser>` -- the same mechanism
`tabbrowser.js` itself uses for tab-title unread indicators -- matched against
a leading `"(N) ..."` pattern in the title, the convention both Discord and
Instagram use for unread counts. Cleared the moment that service is shown.

## Resizing

Drag the sidebar's left edge to resize it (280-800px). The width is saved to
the `cthulhu.sidepanels.width` pref and restored on the next window/panel
open.

## Dropdown player

Clicking the squircle opens a real XUL `<panel type="arrow">` (not the
sidebar) anchored underneath it -- rendered in the OS-level popup layer, so
unlike the sidebar it's immune to the chrome-widget-compositing quirk that
forces the search bar to hide while the sidebar is open (native urlbar
toolbarbuttons paint through `position: fixed` chrome content regardless of
z-index -- confirmed live; see `side-panels.css`'s note above
`#cthulhu-sidepanels`). It shows artwork/title/artist, a seekable progress
bar, transport controls, a mute toggle (there's no volume-*level* API on
`MediaController` at all, only per-tab mute, so that's what "mute" actually
toggles), a row of generic Apple Music browse shortcuts, and a search bar --
both of which open/navigate the Apple Music panel via
`win.CthulhuSidePanels.open("apple-music", url)`. Both player and squircle
render from one shared per-window media tracker (`createMediaTracker()`) that
polls `browsingContext.mediaController` across tabs once and fans the result
out to both UIs, rather than each polling/attaching independently.

## Known limitation: Discord panel UI simplification

The Discord panel gets a best-effort CSS override (via a `messageManagerGroups`
-scoped `JSWindowActor`, `CthulhuDiscordSimplifyChild.sys.mjs`) that hides the
server-icon rail so the narrow panel width goes to the channel list + chat
instead of three cramped columns. This targets Discord's ARIA landmarks
(`aria-label="Servers sidebar"`), not their auto-generated CSS module class
names, for durability -- but it is **unverified against a real, logged-in
Discord session**: this environment has no Discord credentials, and entering
the user's own would mean handling a password, which is out of scope for this
tool. If the panel doesn't look simplified, or looks broken, the selectors in
that file likely need adjusting against a real session.

## Known limitation: Instagram web notifications/DMs

Instagram's web app (`instagram.com`) has materially weaker DM and
notification support than its native app -- some notification types don't
fire at all in-browser, and DMs work but lack a few native-app features (e.g.
disappearing photo/video messages). This is a limitation of Instagram's own
web app, not something this module can work around while staying ToS-safe
(no iframe, no custom client).

## Verify on Windows post-Phase-8

The panel code here is written platform-neutral -- no macOS-specific paths,
prefs, or APIs -- but it has only been exercised on macOS so far. Re-verify
lazy-create/discard, the Web Notifications permission-prompt patch, and both
Discord and Instagram once the project's Windows build (post-Phase-8) is
available; there is no reason to expect platform-specific behavior here, but
it hasn't been confirmed.

## Toggle icons

Each toggle uses the service's own favicon -- fetched and inlined as a data
URL (same technique as the quick-links widget: a live `<img src>` to a remote
URL is blocked on this privileged/chrome surface, but a plain `fetch()`
isn't), cached per host for the session. `assets/discord-icon.png`,
`assets/instagram-icon.png`, `assets/apple-music-icon.png`,
`assets/note-idle.png` are the fallback shown until that resolves (or if every
favicon source fails) -- small abstract shapes, not the real brand marks
(reproducing those isn't something to bake into a repo as a *permanent*
asset, which is why the real favicon is fetched live instead).

## Files

```
side-panels.js                       -- toolbar item (CustomizableUI): service
                                         toggles + unread badges + resizable
                                         sidebar (lazy-create, power-off-to-
                                         discard <browser> per service) +
                                         shared media tracker + dropdown player
SidePanelsWidget.sys.mjs             -- once-per-process widget + actor
                                         registration
CthulhuDiscordSimplifyChild.sys.mjs  -- best-effort Discord panel CSS
                                         simplification (see above)
side-panels.css                       -- A2-themed; toggles, squircle, sidebar,
                                         resize handle, dropdown player
assets/                                -- fallback icon art (see "Toggle icons"
                                         above)
```

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.side-panels.enabled`.
