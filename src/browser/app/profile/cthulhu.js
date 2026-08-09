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
