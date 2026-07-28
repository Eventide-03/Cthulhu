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
