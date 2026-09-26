/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Parent side of tab-audio sharing: the broker between the two tabs.
 *
 * It exists because neither child can reach the other. The sink asks "give me
 * a tab's audio"; the parent is the only place that can put a picker in front
 * of the user, look up whatever tab they chose, and speak to that tab's actor.
 * Three messages carry a session:
 *
 *   sink   -> TabAudio:Want            -> parent picks a tab, starts the source,
 *                                         answers with { sessionId, sdp }
 *   sink   -> TabAudio:Answer          -> parent relays the SDP to the source
 *   sink   -> TabAudio:Ended           -> parent stops the source
 *
 * Sessions live here rather than on the actor because the answer comes back on
 * a second message and has to find the source again. Keyed by a counter, not by
 * browsing context: a tab can be the source of one share and the sink of
 * another at the same time, and they must not collide. */

const gSessions = new Map(); // sessionId -> { source: actor, sinkBC }
let gNextSession = 0;

export class CthulhuTabAudioParent extends JSWindowActorParent {
  async receiveMessage(msg) {
    switch (msg.name) {
      case "TabAudio:Want":
        return this.#want();
      case "TabAudio:Answer":
        return this.#relayAnswer(msg.data);
      case "TabAudio:Ended":
        this.#endFor(this.browsingContext);
        return undefined;
      default:
        return undefined;
    }
  }

  didDestroy() {
    // The sharing tab went away mid-share; the source would otherwise keep its
    // window captured for the life of the browser.
    this.#endFor(this.browsingContext);
  }

  async #want() {
    const chromeWin = this.browsingContext.topChromeWindow;
    // The picker is per-window UI and lives in tab-audio.js. No window, no
    // picker, no audio -- never a silent fallback to "just pick something",
    // because handing a page another tab's audio is exactly the decision that
    // has to be the user's, every time.
    if (!chromeWin || !chromeWin.CthulhuTabAudio) {
      return null;
    }
    let tab = null;
    try {
      tab = await chromeWin.CthulhuTabAudio.pick({
        requester: this.browsingContext.top.embedderElement,
      });
    } catch (e) {
      console.error("[Cthulhu:tab-audio] picker failed:", e);
      return null;
    }
    if (!tab) {
      return null; // "Don't share audio", or dismissed
    }
    const wg = tab.linkedBrowser?.browsingContext?.currentWindowGlobal;
    const source = wg && wg.getActor("CthulhuTabAudio");
    if (!source) {
      return null;
    }
    let res;
    try {
      res = await source.sendQuery("TabAudio:StartSource", {});
    } catch (e) {
      console.error("[Cthulhu:tab-audio] the chosen tab could not be captured:", e);
      return null;
    }
    if (!res || !res.offer) {
      return null;
    }
    const sessionId = String(++gNextSession);
    gSessions.set(sessionId, { source, sinkBC: this.browsingContext });
    return { sessionId, sdp: res.offer };
  }

  async #relayAnswer(data) {
    const s = data && gSessions.get(data.sessionId);
    if (!s) {
      return undefined;
    }
    try {
      await s.source.sendQuery("TabAudio:SourceAnswer", { sdp: data.sdp });
    } catch (e) {
      console.error("[Cthulhu:tab-audio] relaying the answer failed:", e);
      gSessions.delete(data.sessionId);
    }
    return undefined;
  }

  #endFor(sinkBC) {
    for (const [id, s] of gSessions) {
      if (s.sinkBC !== sinkBC) {
        continue;
      }
      gSessions.delete(id);
      try {
        s.source.sendAsyncMessage("TabAudio:Stop", {});
      } catch (e) {}
    }
  }
}

/** Tabs currently feeding a share, for the picker and any indicator. */
export function isSharingAudio(browser) {
  const bc = browser && browser.browsingContext;
  if (!bc) {
    return false;
  }
  for (const s of gSessions.values()) {
    if (s.source.browsingContext === bc) {
      return true;
    }
  }
  return false;
}
