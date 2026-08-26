// -*- Mode: javascript; c-basic-offset: 2; indent-tabs-mode: nil -*-
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// ============================================================================
// Cthulhu default preferences (debloat)
//
// DEFAULT preferences only: every entry uses pref(), which sets the value on the
// *default* branch, so users can still override any of them in about:config.
// (lockPref() would make them read-only — we intentionally do NOT use it.)
//
// Load order note: Firefox reads defaults/preferences/*.js in REVERSE
// alphabetical order (see modules/libpref/Preferences.cpp: pref_CompareFileNames
// swaps its args, and the omni path iterates in reverse), so the alphabetically
// EARLIEST filename is loaded LAST and wins. "cthulhu.js" sorts before
// "firefox.js", so these values are applied after — and override — Mozilla's
// upstream defaults.
// ============================================================================

// -- Telemetry & data collection (off) --
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);

// -- Pocket & recommendations (off) --
pref("extensions.pocket.enabled", false);
pref("browser.discovery.enabled", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);

// -- New-tab sponsored content (off) --
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);

// -- Firefox Accounts / Sync (off) --
pref("identity.fxaccounts.enabled", false);

// -- Annoyances (off) --
pref("browser.shell.checkDefaultBrowser", false);
pref("browser.aboutConfig.showWarning", false);

// -- First-run "import from another browser" onboarding (fresh-install opt-in) --
// The unofficial branding sets startup.homepage_welcome_url to "" (see
// browser/branding/unofficial/pref/firefox-branding.js), which suppresses
// about:welcome on first run -> the onboarding import step never appears.
// Point it at about:welcome so a brand-new profile gets the onboarding flow,
// whose easy-setup screen offers "import your data" (the embedded migration
// wizard, which auto-detects installed browsers incl. Chrome). This wins over
// the branding value because defaults/preferences/*.js load in REVERSE
// alphabetical order, so "cthulhu.js" loads after "firefox-branding.js".
pref("startup.homepage_welcome_url", "about:welcome");
// Required gates for the embedded import step (both are Firefox defaults; set
// explicitly so the fork's first-run-import intent stays stable):
pref("browser.aboutwelcome.enabled", true);
pref("browser.migrate.content-modal.about-welcome-behavior", "embedded");

// -- Home page / startup: the New Tab grid --
// about:cthulhu is registered as a privileged built-in page at chrome startup
// (see theme/content/newtab/AboutCthulhu.sys.mjs), which also overrides the New
// Tab URL. Startup + new windows open the New Tab grid (about:cthulhu), so the
// home grid is NOT auto-opened as its own tab; it's reached on demand via the
// home button (which loads about:cthulhu#home in the current tab). The two grids
// keep separate saved layouts. Default (not locked) so it stays overridable.
pref("browser.startup.homepage", "about:cthulhu");

// -- Caret browsing OFF -- prevents the stray blinking text caret from appearing
// in non-editable page content, and disables the F7 shortcut that toggles it.
pref("accessibility.browsewithcaret", false);
pref("accessibility.browsewithcaret_shortcut.enabled", false);

// -- Extensions button: hidden by default (Cthulhu ships no extensions, so it's
// dead toolbar space) instead of always shown. Firefox default is true; this
// is the same pref its own toolbar right-click menu's "Always Show in Toolbar"
// checkbox controls, so re-checking that box (or installing an extension that
// needs attention) brings it back -- nothing else to configure.
pref("extensions.unifiedExtensions.button.always_visible", false);

// -- Ambient theming: weather kill switch (privacy) --
// The ambient theme derives its palette from time of day (computed locally from
// a solar formula -- no network) and, optionally, current weather from
// Open-Meteo. The weather lookup is the ONLY outbound request this browser makes
// beyond normal browsing that involves location, so it gets an explicit switch.
//
// Set to false and no coordinates ever leave the machine: the Open-Meteo request
// is skipped entirely and theming falls back to time-of-day only. Documented in
// PRIVACY.md.
//
// Default true = feature works as designed. Flip this one value to false if you
// would rather ship weather theming as opt-in.
pref("cthulhu.ambient.weather.enabled", true);

// -- Override Surfer's hardcoded Zen Browser URLs --
// Surfer (the Zen Browser build tool) generates the branding pref file
// browser/branding/<brand>/pref/firefox-branding.js with zen-browser.app URLs
// baked in -- see configureProfileBranding() in its branding-patch. Left alone,
// a branded build would point users at Zen Browser from the About dialog's
// release-notes link, from the post-update "what's new" page, and from the
// update-failure fallback pages.
//
// These win by load order: defaults/preferences/*.js are read in REVERSE
// alphabetical order, and "cthulhu.js" sorts before "firefox-branding.js", so
// this file is applied last (same mechanism documented at the top of this file).
// Post-update "what's new" page. Opened ONCE after an update changes the
// milestone (BrowserContentHandler's OVERRIDE_NEW_MSTONE path), resolved
// through Services.urlFormatter, which substitutes %VERSION%. CI publishes
// the matching page under docs/whatsnew/<version>/ at release time.
pref("startup.homepage_override_url", "https://eventide-03.github.io/Cthulhu/whatsnew/%VERSION%/");
pref("startup.homepage_welcome_url.additional", "");
pref("app.update.url.manual", "https://github.com/Eventide-03/Cthulhu/releases");
pref("app.update.url.details", "https://github.com/Eventide-03/Cthulhu/releases");
pref("app.releaseNotesURL", "https://github.com/Eventide-03/Cthulhu/releases");
pref("app.releaseNotesURL.aboutDialog", "https://github.com/Eventide-03/Cthulhu/releases");
pref("app.releaseNotesURL.prompt", "https://github.com/Eventide-03/Cthulhu/releases");

// -- Automatic updates (on by default) --
// app.update.auto is a real pref on macOS/Linux; on Windows the value lives in
// a per-installation config file and this pref supplies the initial default.
pref("app.update.auto", true);
// The background update agent checks for and stages updates while the browser
// is closed, so an update is ready on next launch rather than downloading then.
pref("app.update.background.enabled", true);
pref("app.update.background.scheduling.enabled", true);

// -- Feature-request relay --
// The PUBLIC URL of the Cloudflare Worker that forwards feature requests to
// Discord. This is not a secret -- it is a public endpoint, and deliberately so:
// the Discord webhook itself lives only in the Worker's environment, because a
// webhook baked into the browser would be extractable from the binary.
//
// Empty by default. Set it to your deployed Worker URL (see relay/README.md);
// until then the feature-request button and widget say so instead of failing
// silently.
pref("cthulhu.relay.url", "");
