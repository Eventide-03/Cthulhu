/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Best-effort CSS simplification of Discord's web app when it's loaded inside
 * the Cthulhu side panel (narrow, ~280-800px wide vs. Discord's normal
 * full-window layout): hides the server rail so the panel opens straight into
 * a channel/DM list + the active conversation, instead of showing three
 * cramped columns (servers, channels, chat) in a space designed for one.
 *
 * UNVERIFIED against a real, logged-in Discord session -- this environment has
 * no Discord credentials and entering the user's own would be handling a
 * password, which is out of scope for this tool. Targets ARIA landmarks
 * (aria-label), not Discord's auto-generated CSS module classnames (those
 * change across their deploys and would be far more fragile), but Discord
 * could still rename/restructure these landmarks at any time. If the panel UI
 * doesn't look simplified, the selectors below likely need adjusting against
 * a real session -- see the side-panels README for the same caveat already
 * documented for Instagram's more limited web-app feature set. */

const STYLE_ID = "cthulhu-discord-simplify-style";

const CSS = `
  /* Server rail: the leftmost icon column (servers/DMs switcher). Hiding it
   * gives the channel list + chat the full panel width. The DM/"Home" entry
   * still reachable via Discord's own in-app navigation once inside a server
   * view; this only removes the icon strip, not functionality. */
  nav[aria-label="Servers sidebar"],
  nav[aria-label*="Servers" i] {
    display: none !important;
  }
  /* Discord reserves a fixed left offset in its own layout for the rail above
   * -- without this, removing the rail leaves a blank gutter instead of the
   * channel list expanding to fill it. */
  [class*="sidebar-"][class*="layers-"],
  #app-mount [class^="app-"] {
    padding-inline-start: 0 !important;
  }
`;

export class CthulhuDiscordSimplifyChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== "DOMContentLoaded") return;
    const doc = this.document;
    let hostname = "";
    try { hostname = doc.location.hostname; } catch (e) { return; }
    if (!/(^|\.)discord\.com$/.test(hostname)) return;
    this.inject(doc);
  }

  inject(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
}
