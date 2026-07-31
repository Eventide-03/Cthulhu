/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Parent side of the file-picker actor: a small session list of recent uploads,
 * shared across all frames (this ES module is a per-process singleton). */

let recents = []; // [{ name, type, dataUrl }]

export class CthulhuFilePickerParent extends JSWindowActorParent {
  receiveMessage(msg) {
    switch (msg.name) {
      case "getRecents":
        return recents;
      case "addRecent": {
        const r = msg.data;
        if (r && typeof r.dataUrl === "string" && r.dataUrl.length < 6_000_000) {
          recents = [r, ...recents.filter((x) => x.dataUrl !== r.dataUrl)].slice(0, 8);
        }
        return null;
      }
    }
    return null;
  }
}
