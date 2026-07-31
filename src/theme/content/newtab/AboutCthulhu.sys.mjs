/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Registers about:cthulhu as a privileged built-in page backed by
 * chrome://cthulhu/content/newtab/index.html, and overrides the browser's
 * new-tab URL to point at it. Imported once per process from browser.js at
 * chrome startup — ES modules are singletons, so registration runs a single
 * time (the CID guard makes re-import a no-op besides).
 *
 * Because the page resolves to a chrome:// resource it runs with the system
 * principal, which is what lets it (a) load chrome://cthulhu/content/theme.css
 * for its styling and (b) fetch cross-origin without CORS restrictions (for the
 * calendar widget later). IS_SECURE_CHROME_UI keeps it in the parent process
 * (like about:preferences); ENABLE_INDEXED_DB permits IndexedDB persistence. */

const PAGE = "chrome://cthulhu/content/newtab/index.html";
const CONTRACT = "@mozilla.org/network/protocol/about;1?what=cthulhu";
const CID = Components.ID("{b7e8f2a0-3c4d-4e5f-8a9b-0c1d2e3f4a5b}");

class AboutCthulhu {
  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule"]);

  newChannel(aURI, aLoadInfo) {
    const channel = Services.io.newChannelFromURIWithLoadInfo(
      Services.io.newURI(PAGE),
      aLoadInfo
    );
    channel.originalURI = aURI; // keep the address bar showing about:cthulhu
    return channel;
  }

  getURIFlags(aURI) {
    const A = Ci.nsIAboutModule;
    return (
      A.ALLOW_SCRIPT |
      A.IS_SECURE_CHROME_UI |
      A.ENABLE_INDEXED_DB |
      A.HIDE_FROM_ABOUTABOUT
    );
  }

  getChromeURI(aURI) {
    return Services.io.newURI(PAGE);
  }
}

const Factory = {
  QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
  createInstance(iid) {
    return new AboutCthulhu().QueryInterface(iid);
  },
};

const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
if (!registrar.isCIDRegistered(CID)) {
  registrar.registerFactory(CID, "Cthulhu about:cthulhu", CONTRACT, Factory);
}

// Override the New Tab page (parent-process service; safe to set repeatedly).
try {
  const { AboutNewTab } = ChromeUtils.importESModule(
    "resource:///modules/AboutNewTab.sys.mjs"
  );
  if (AboutNewTab.newTabURL !== "about:cthulhu") {
    AboutNewTab.newTabURL = "about:cthulhu";
  }
} catch (e) {
  console.error("[Cthulhu] could not override new-tab URL:", e);
}
