/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Hide the pointer while it sits still over a playing video.
 *
 * WHY THIS HAS TO EXIST HERE. Every site that plays film does this itself --
 * YouTube, Netflix and Twitch all drop `cursor: none` on the player after a
 * few seconds of stillness. cursors.css is a user-origin sheet and every rule
 * in it is !important, which outranks any author rule, so the cursor theme was
 * quietly overriding all of them and the pointer sat on top of the picture
 * forever. Firefox's own video controls never touch the cursor (there is not
 * one `cursor` declaration in videocontrols.css), so with the sites overruled
 * there was nothing left to hide it.
 *
 * The theme cannot simply bow out of `cursor: none` the way it bows out of
 * :fullscreen -- CSS has no way to say "unless the page asked for none", and a
 * user-origin !important declaration beats the page whatever it targets. So
 * the behaviour is reimplemented here instead of merely being got out of the
 * way, which also means it works on a player that never implemented it.
 *
 * WHEN IT HIDES. The pointer has to have been still for IDLE_MS over a video
 * that is actually playing, and either the page is fullscreen or that video is
 * big enough to be something you are watching rather than a thumbnail or a
 * decorative loop behind a hero banner. Anything you do -- move, click,
 * scroll, type -- brings it straight back, as does the video stopping.
 *
 * COST. The pointer listeners only exist while something is playing: they go on
 * at the first `play` and come off once nothing is playing any more, so an
 * ordinary page carries no mousemove handler at all. The idle check itself runs
 * once per three seconds of stillness, never per move. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const ATTR = "cthulhu-cursor-idle";
const IDLE_MS = 3000; // what YouTube and friends use, near enough
// Below this a video is a thumbnail, a preview tile, or something looping
// behind a banner -- none of them a thing you are sitting still to watch.
const MIN_W = 300;
const MIN_H = 200;
// Everything that counts as "you are still here". Captured and in the system
// group so a player calling stopPropagation on its own overlay cannot strand
// the pointer hidden.
const WAKE = ["mousemove", "mousedown", "wheel", "keydown"];

export class CthulhuCursorIdleChild extends JSWindowActorChild {
  #timer = null;
  #listening = false;
  #hidden = false;
  #x = -1;
  #y = -1;

  handleEvent(event) {
    switch (event.type) {
      case "play":
        this.#listen();
        this.#arm();
        break;
      case "pause":
      case "ended":
      case "fullscreenchange":
        this.#show();
        this.#settle();
        break;
      case "mousemove":
        this.#x = event.clientX;
        this.#y = event.clientY;
        this.#show();
        this.#arm();
        break;
      default: // mousedown / wheel / keydown
        this.#show();
        this.#arm();
        break;
    }
  }

  didDestroy() {
    this.#disarm();
    this.#listening = false; // the window is going; its listeners go with it
  }

  /* ------------------------------- the rule ------------------------------- */

  #shouldHide() {
    const doc = this.document;
    if (!doc || doc.hidden) {
      return false;
    }
    const playing = this.#playing();
    if (!playing.length) {
      return false;
    }
    // Fullscreen: the player owns the whole screen, so where the pointer is
    // does not matter -- there is nothing else for it to be over.
    const fs = doc.fullscreenElement;
    if (fs) {
      return playing.some((v) => fs === v || fs.contains(v));
    }
    if (this.#x < 0) {
      return false; // the pointer has not been over this document at all
    }
    return playing.some((v) => {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) {
        return false;
      }
      return this.#x >= r.left && this.#x <= r.right && this.#y >= r.top && this.#y <= r.bottom;
    });
  }

  #playing() {
    const doc = this.document;
    if (!doc) {
      return [];
    }
    try {
      // readyState: a video that is "playing" but has no frames yet is still
      // buffering, and the pointer should stay put until there is a picture.
      return [...doc.querySelectorAll("video")].filter(
        (v) => !v.paused && !v.ended && v.readyState >= 2
      );
    } catch (e) {
      return [];
    }
  }

  /* ------------------------------ the switch ------------------------------ */

  #hide() {
    if (this.#hidden) {
      return;
    }
    const el = this.document && this.document.documentElement;
    if (!el) {
      return;
    }
    this.#hidden = true;
    try { el.setAttribute(ATTR, ""); } catch (e) {}
  }

  #show() {
    if (!this.#hidden) {
      return;
    }
    this.#hidden = false;
    const el = this.document && this.document.documentElement;
    try { el && el.removeAttribute(ATTR); } catch (e) {}
  }

  /* ------------------------------- plumbing ------------------------------- */

  #arm() {
    this.#disarm();
    this.#timer = lazy.setTimeout(() => {
      this.#timer = null;
      if (this.#shouldHide()) {
        this.#hide();
      }
    }, IDLE_MS);
  }

  #disarm() {
    if (this.#timer !== null) {
      lazy.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /* Nothing playing any more: stop watching the pointer until the next play.
   * Called on pause/ended rather than tearing down on the first one, because a
   * page with several videos may still have one running. */
  #settle() {
    if (this.#playing().length) {
      this.#arm();
    } else {
      this.#disarm();
      this.#unlisten();
    }
  }

  #listen() {
    if (this.#listening) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    this.#listening = true;
    for (const type of WAKE) {
      win.addEventListener(type, this, { capture: true, passive: true, mozSystemGroup: true });
    }
  }

  #unlisten() {
    if (!this.#listening) {
      return;
    }
    const win = this.contentWindow;
    this.#listening = false;
    if (!win) {
      return;
    }
    for (const type of WAKE) {
      win.removeEventListener(type, this, { capture: true, mozSystemGroup: true });
    }
  }
}
