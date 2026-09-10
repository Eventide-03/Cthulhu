/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Child side of the tab-volume actor (runs in each content frame).
 *
 * Gecko exposes no per-tab volume to chrome, so the player's slider works on
 * the page's own <audio> and <video> elements: whatever volume the tab wants
 * is set on every media element that exists, and on each one that starts
 * playing later (the `play` event, captured, catches elements the page creates
 * after the fact). A fresh document (navigation, reload) asks the parent for
 * its tab's level on pageshow. A page that drives its own volume control can
 * set the element's volume again afterwards; the slider's next move sets it
 * back. A Web Audio player has no media element and is unaffected.
 *
 * Nothing is done for a tab left at 1 (the default): the page's own volumes
 * are never touched unless the slider has been moved for that tab. */
export class CthulhuTabVolumeChild extends JSWindowActorChild {
  #volume = null; // null = no override for this tab

  receiveMessage(msg) {
    if (msg.name === "CthulhuTabVolume:State") {
      // For tests: what this frame believes, and what its media elements are at.
      let media = [];
      try { media = [...this.document.querySelectorAll("audio, video")].map((el) => el.volume); } catch (e) {}
      return { volume: this.#volume, media };
    }
    if (msg.name !== "CthulhuTabVolume:Set") return undefined;
    const v = Number(msg.data && msg.data.volume);
    this.#volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
    this.#applyAll();
    return undefined;
  }

  async handleEvent(event) {
    if (event.type === "play") {
      if (this.#volume === null) await this.#ask();
      this.#apply(event.target);
      return;
    }
    if (event.type === "pageshow") {
      await this.#ask();
      this.#applyAll();
    }
  }

  async #ask() {
    try {
      const v = await this.sendQuery("CthulhuTabVolume:Get");
      if (typeof v === "number" && v < 1) this.#volume = v;
    } catch (e) {}
  }

  #apply(el) {
    if (this.#volume === null) return;
    try {
      if (el && typeof el.volume === "number" && el.volume !== this.#volume) el.volume = this.#volume;
    } catch (e) {}
  }

  #applyAll() {
    if (this.#volume === null) return;
    let doc;
    try { doc = this.document; } catch (e) { return; }
    if (!doc) return;
    for (const el of doc.querySelectorAll("audio, video")) this.#apply(el);
  }
}
