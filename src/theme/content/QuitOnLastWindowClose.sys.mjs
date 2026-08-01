/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* On macOS, Firefox deliberately keeps the app process alive (dock icon, no
 * windows) when the last browser window closes -- see browser.js's
 * WindowIsClosing() / "browser-lastwindow-close-granted" and its comment
 * ("OS X doesn't quit the application when the last window is closed").
 * That's a platform convention Cthulhu doesn't want: closing the last window
 * -- on any tab, including the about:cthulhu home page reached via the Home
 * button (it's a normal tab, not special-cased anywhere) -- should quit the
 * app, matching what already happens on Windows/Linux.
 *
 * "browser-lastwindow-close-granted" fires once the close is already decided
 * (not cancelable at this point; any "N tabs will be closed" warning has
 * already been shown/dismissed), so eAttemptQuit here just runs the same
 * standard, cancelable shutdown sequence a normal Cmd+Q would -- it can still
 * be blocked by a legitimate quit-blocker (e.g. an active download), same as
 * on other platforms.
 *
 * Imported once per process from browser.js -- ES modules are singletons, so
 * this registration runs once regardless of how many windows import it. */

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

if (AppConstants.platform == "macosx") {
  Services.obs.addObserver(
    { observe: () => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit) },
    "browser-lastwindow-close-granted"
  );
}
