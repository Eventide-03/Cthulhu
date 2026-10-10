/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * A "Clear Downloads" button in the downloads panel.
 *
 * Firefox can clear the list, but only from the panel's RIGHT-CLICK menu, where
 * it is called "Clear Preview Panel" -- a name that does not read like the
 * thing you want, on a menu most people never open. So the list just grows.
 * The panel's footer has room for it: upstream puts one button there ("Show All
 * Downloads") in a vbox that takes a second without any restructuring.
 *
 * WHAT IT RUNS. `downloadsCmd_clearList`, which is the panel's own command
 * (DownloadsViewController.supportsCommand lists it explicitly) and comes down
 * to DownloadsCommon.getData(window).removeFinished() -- it drops the finished,
 * cancelled and failed entries from the list and leaves everything else alone.
 *
 * Not `downloadsCmd_clearDownloads`, the one behind the Library's button of
 * this name, for two reasons: the panel's controller does not support it (it
 * lives in allDownloadsView.js, so from here it would do nothing at all), and
 * it ALSO deletes every download visit from browsing history, which is a good
 * deal more than a button in this panel should do unasked.
 *
 * The label is upstream's own `downloads-clear-downloads-button`, already
 * translated everywhere and already loaded in this window (the panel markup
 * pulls in browser/downloads.ftl), so this adds no strings of its own. Its
 * tooltip -- "Clears completed, canceled and failed downloads" -- happens to
 * describe removeFinished() exactly.
 * ========================================================================== */
(function () {
  "use strict";

  const ID = "cthulhu-downloads-clear";
  const CMD = "downloadsCmd_clearList";

  function enabled(button) {
    // The controller knows whether there is anything to clear
    // (canRemoveFinished); a panel with one download still running has not.
    // If it cannot be reached for any reason, leave the button alive rather
    // than dead -- the command itself is a no-op when there is nothing to do.
    try {
      const c = window.DownloadsViewController;
      button.disabled = !!c && !c.isCommandEnabled(CMD);
    } catch (e) {
      button.disabled = false;
    }
  }

  function build(footer) {
    if (document.getElementById(ID)) {
      return true;
    }
    const button = document.createXULElement("button");
    button.id = ID;
    button.setAttribute("data-l10n-id", "downloads-clear-downloads-button");
    // The same classes upstream gives "Show All Downloads", so the two are one
    // footer rather than a footer and a stranger: hover, focus ring, padding
    // and height all come from the panel's own styles.
    button.setAttribute(
      "class",
      "downloadsPanelFooterButton subviewbutton panel-subview-footer-button toolbarbutton-1"
    );
    button.setAttribute("flex", "1");
    button.setAttribute("pack", "start");
    button.addEventListener("command", () => {
      goDoCommand(CMD);
      // Close rather than leave an empty panel sitting open: the list the panel
      // exists to show is gone, and there is nothing left to click.
      try { DownloadsPanel.hidePanel(); } catch (e) {}
    });
    // After "Show All Downloads", so the everyday button stays where muscle
    // memory left it and the destructive one is last.
    footer.appendChild(button);
    return true;
  }

  function attach() {
    const footer = document.getElementById("downloadsFooterButtons");
    if (!footer) {
      return false;
    }
    build(footer);
    const panel = document.getElementById("downloadsPanel");
    if (panel) {
      // Recomputed every time the panel opens: whether there is anything to
      // clear changes as downloads finish, and nothing else would tell us.
      panel.addEventListener("popupshowing", () => {
        const b = document.getElementById(ID);
        if (b) {
          enabled(b);
        }
      });
    }
    return true;
  }

  // The panel markup is static (main-popupset.inc.xhtml includes it into
  // browser.xhtml), so this normally lands first time. The fallback is for a
  // window where the popupset has not been parsed yet when modules load.
  if (!attach()) {
    window.addEventListener("load", () => attach(), { once: true });
  }
})();
