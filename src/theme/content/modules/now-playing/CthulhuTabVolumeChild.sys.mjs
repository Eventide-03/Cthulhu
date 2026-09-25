/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Child side of the tab-volume actor (runs in each content frame).
 *
 * Gecko exposes no per-tab volume to chrome, so the player's slider works on
 * the page. On YouTube it drives the page's own player -- #movie_player
 * carries the player API (setVolume 0..100 / getVolume / isMuted / unMute) --
 * so the page's slider moves and the page keeps the level for the next track;
 * setting the element's volume alone did neither, the page put its own level
 * straight back. On YouTube Music the bar's slider (a tp-yt-paper-slider) is
 * the user's level and the app maps it onto the player with a curve of its
 * own (measured: slider 30 -> player 8, 55 -> 24), so there the slider is
 * what is moved and read, and the player and element are left to the app --
 * writing either would fight that curve. Everywhere else the tab's level is
 * set on the page's <audio> and <video> elements:
 * every one that exists, and each one that starts playing later (the `play`
 * event, captured, catches elements the page creates after the fact). A fresh
 * document (navigation, reload) asks the parent for its tab's level on
 * pageshow. A page that drives its own volume control and is not YouTube can
 * set the element's volume again afterwards; the slider's next move sets it
 * back. A Web Audio player has no media element and is unaffected.
 *
 * The page's level is also reported back (CthulhuTabVolume:Level) so the
 * player's speaker and slider follow the page: YouTube Music's slider, else
 * the player API's getVolume, else the main element's volume. A read that
 * finds the page somewhere else ADOPTS that level as this frame's override --
 * see #adopt, and the note there on why a stale override used to push a
 * change made on the page's own volume control straight back.
 */
export class CthulhuTabVolumeChild extends JSWindowActorChild {
  #volume = null; // null = no override for this tab
  #seen = null;   // the previous page level read, for the two-in-a-row rule in #adopt

  receiveMessage(msg) {
    if (msg.name === "CthulhuTabVolume:State") {
      // For tests: what this frame believes, and what its media elements are at.
      let media = [];
      try { media = [...this.document.querySelectorAll("audio, video")].map((el) => el.volume); } catch (e) {}
      return { volume: this.#volume, media };
    }
    if (msg.name === "CthulhuTabVolume:Position") {
      return this.#position();
    }
    if (msg.name === "CthulhuTabVolume:Level") {
      return this.#level();
    }
    if (msg.name === "CthulhuTabVolume:Seek") {
      const t = Number(msg.data && msg.data.time);
      if (Number.isFinite(t)) {
        const el = this.#mainMedia();
        try { if (el) el.currentTime = Math.max(0, Math.min(t, el.duration || t)); } catch (e) {}
      }
      return undefined;
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
      // A site player applies its own level to the element on play; ours
      // goes through that player so the two agree.
      if (this.#volume !== null && !this.#applySite()) this.#apply(event.target);
      return;
    }
    if (event.type === "pageshow") {
      this.#seen = null; // a new document's level is nobody's move yet
      await this.#ask();
      this.#applyAll();
    }
  }

  /* The frame's main media element: one that is playing with a finite
   * duration, else any with a finite duration. A stream (duration Infinity)
   * has no position to report; null then, and the card says "live". */
  #mainMedia() {
    let best = null;
    let doc;
    try { doc = this.document; } catch (e) { return null; }
    if (!doc) return null;
    for (const el of doc.querySelectorAll("audio, video")) {
      const d = el.duration;
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const playing = !el.paused && !el.ended;
      if (!best || (playing && best.paused)) best = el;
      if (playing) break;
    }
    return best;
  }
  #position() {
    const el = this.#mainMedia();
    if (!el) return null;
    try {
      return { position: el.currentTime, duration: el.duration, rate: el.playbackRate || 1, playing: !el.paused && !el.ended };
    } catch (e) { return null; }
  }

  /* YouTube and YouTube Music: the page's player, reached through the page's
   * own global (the actor's window is an Xray; the API lives on the page's
   * element). Null anywhere else, or before the player exists. */
  #sitePlayer() {
    let w;
    try { w = this.contentWindow && this.contentWindow.wrappedJSObject; } catch (e) { return null; }
    if (!w) return null;
    let host = "";
    try { host = String(w.location.hostname || ""); } catch (e) { return null; }
    if (!/(^|\.)youtube\.com$/.test(host)) return null;
    try {
      const p = w.document.getElementById("movie_player");
      if (p && typeof p.setVolume === "function" && typeof p.getVolume === "function") return p;
    } catch (e) {}
    return null;
  }
  /* YouTube Music's own slider, or null. */
  #musicSlider() {
    let w;
    try { w = this.contentWindow && this.contentWindow.wrappedJSObject; } catch (e) { return null; }
    try {
      if (!/(^|\.)music\.youtube\.com$/.test(String(w.location.hostname || ""))) return null;
      const s = w.document.querySelector("ytmusic-player-bar #volume-slider");
      return s && typeof s.value === "number" ? s : null;
    } catch (e) { return null; }
  }
  /* True when a site owns the level and took it; the elements are then its
   * business, not ours. */
  #applySite() {
    const n = Math.round(this.#volume * 100);
    const s = this.#musicSlider();
    if (s) {
      try {
        if (s.value !== n) {
          s.value = n;
          s.dispatchEvent(new this.contentWindow.wrappedJSObject.Event("change", { bubbles: true }));
        }
        return true;
      } catch (e) { /* fall through to the player */ }
    }
    const p = this.#sitePlayer();
    if (!p) return false;
    try {
      p.setVolume(n);
      if (n > 0 && typeof p.isMuted === "function" && p.isMuted()) p.unMute();
    } catch (e) { return false; }
    return true;
  }
  /* Read the page's level, and take a move the page made as our own. */
  #level() {
    const got = this.#pageLevel();
    if (got) this.#adopt(got.volume);
    return got;
  }

  /* A level the page moved to itself becomes this frame's override.
   *
   * The override is whatever the player's slider last set, and it is
   * re-applied on every `play` -- YouTube Music fires one on each track -- and
   * again on pageshow. Left stale that pushed a change made on the page's own
   * volume control straight back, which is the bug this exists to stop.
   * Adopting keeps the two in step: the next apply is a no-op, and the
   * player's speaker and slider already follow (now-playing.js reads this back
   * every couple of seconds).
   *
   * Only with an override in hand. With none nothing is re-applied, the page
   * owns its level outright, and taking one now would start overriding a page
   * that never asked for it.
   *
   * And only once the level holds still for two reads running (~2s apart). A
   * page that RAMPS its element's volume -- a crossfade, an ad ducking under
   * -- is passing through, not settling, and a value adopted mid-ramp would
   * pin the tab at it; a fade-out caught near its end would pin it at silence.
   * A drag of the page's own slider settles the moment it is let go.
   */
  #adopt(v) {
    if (!(v >= 0 && v <= 1)) return;
    const settled = this.#seen !== null && Math.abs(v - this.#seen) < 0.005;
    this.#seen = v;
    if (!settled || this.#volume === null) return;
    if (Math.abs(v - this.#volume) < 0.005) return;
    this.#volume = v;
    // The parent's registry is what a freshly loaded frame's "what does my tab
    // want?" reads; leaving the old level there would snap the page back on
    // the next reload.
    try {
      this.sendAsyncMessage("CthulhuTabVolume:Adopted", { volume: v });
    } catch (e) {}
  }

  #pageLevel() {
    const s = this.#musicSlider();
    if (s) {
      try { return { volume: Math.max(0, Math.min(1, s.value / 100)), playing: true }; } catch (e) {}
    }
    const p = this.#sitePlayer();
    if (p) {
      try {
        const v = p.getVolume();
        if (typeof v === "number") return { volume: Math.max(0, Math.min(1, v / 100)), playing: true };
      } catch (e) {}
    }
    const el = this.#mainMedia();
    if (!el) return null;
    try { return { volume: el.volume, playing: !el.paused && !el.ended }; } catch (e) { return null; }
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
    if (this.#applySite()) return;
    let doc;
    try { doc = this.document; } catch (e) { return; }
    if (!doc) return;
    for (const el of doc.querySelectorAll("audio, video")) this.#apply(el);
  }
}
