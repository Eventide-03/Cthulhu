/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Parent side of the tab-volume actor, and the one place the volumes live.
 *
 * TabVolumes maps a tab's browserId (stable for the life of the tab, shared by
 * every frame in it, and the one thing an actor can read off its browsing
 * context) to the level the player's slider set. now-playing.js writes it and
 * pushes changes to live frames itself; this actor only answers a freshly
 * loaded frame's "what does my tab want?" by looking the id up here. A map in
 * this module rather than a walk to the window: from inside an actor module
 * the <browser>'s ownerGlobal is not reachable (measured -- it came back
 * empty), so the answer was always the default. */
export const TabVolumes = new Map(); // browserId -> 0..1

export class CthulhuTabVolumeParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name !== "CthulhuTabVolume:Get") return undefined;
    try {
      const id = this.browsingContext && this.browsingContext.browserId;
      if (id && TabVolumes.has(id)) return TabVolumes.get(id);
    } catch (e) {}
    return 1;
  }
}
