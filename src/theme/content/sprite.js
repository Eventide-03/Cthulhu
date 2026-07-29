/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* =============================================================================
 * Cthulhu sprite helper — lightweight horizontal-spritesheet playback.
 *
 *   window.CthulhuSprite.play(el, opts)          // explicit params
 *   window.CthulhuSprite.fromAseprite(el, url)    // derive params from Aseprite JSON
 *
 * Assumes a HORIZONTAL strip: frames laid left-to-right, uniform frame size.
 * Two modes: "css" (a steps() @keyframes animation — see sprite.css) or "js"
 * (a setInterval frame-stepper). Both return a controller with .stop().
 * ============================================================================= */
"use strict";

window.CthulhuSprite = {
  /**
   * @param {Element} el
   * @param {Object}  o  { src, frameWidth, frameHeight, frames, fps=12,
   *                       mode:"css"|"js"="css", loop=true }
   * @returns {{mode:string, stop:Function}}
   */
  play(el, o) {
    const win = el.ownerGlobal || window;
    const fps = o.fps || 12;
    const loop = o.loop !== false;

    el.classList.add("cthulhu-sprite");
    el.style.width = o.frameWidth + "px";
    el.style.height = o.frameHeight + "px";
    el.style.backgroundImage = 'url("' + o.src + '")';
    el.style.backgroundPositionX = "0px";

    if (o.mode === "js") {
      let frame = 0;
      const timer = win.setInterval(function () {
        el.style.backgroundPositionX = -frame * o.frameWidth + "px";
        frame += 1;
        if (frame >= o.frames) {
          if (loop) {
            frame = 0;
          } else {
            win.clearInterval(timer);
          }
        }
      }, 1000 / fps);
      return { mode: "js", stop: function () { win.clearInterval(timer); } };
    }

    // default: CSS steps() using the shared @keyframes cthulhu-sprite-play.
    el.style.setProperty("--cthulhu-sprite-end", -o.frames * o.frameWidth + "px");
    el.style.animation =
      "cthulhu-sprite-play " + o.frames / fps + "s steps(" + o.frames + ") " +
      (loop ? "infinite" : "1");
    return { mode: "css", stop: function () { el.style.animation = "none"; } };
  },

  /**
   * Load an Aseprite spritesheet JSON, derive frame size/count (and fps from the
   * per-frame durations unless overridden), then play. The PNG is `meta.image`
   * resolved relative to the JSON's folder.
   * @param {Element} el
   * @param {string}  jsonUrl
   * @param {Object}  o  { mode, fps, loop } (all optional)
   */
  async fromAseprite(el, jsonUrl, o) {
    o = o || {};
    const win = el.ownerGlobal || window;
    const resp = await win.fetch(jsonUrl);
    if (!resp.ok) {
      throw new Error("sprite JSON " + resp.status + " for " + jsonUrl);
    }
    const data = await resp.json();
    // Aseprite "Hash" -> object, "Array" -> array. Support both.
    const frames = Array.isArray(data.frames)
      ? data.frames
      : Object.values(data.frames);
    const f0 = frames[0].frame;
    const dir = jsonUrl.slice(0, jsonUrl.lastIndexOf("/") + 1);
    const src = dir + ((data.meta && data.meta.image) || "");

    let fps = o.fps;
    if (!fps) {
      const avg =
        frames.reduce((s, fr) => s + (fr.duration || 100), 0) / frames.length;
      fps = Math.max(1, Math.round(1000 / avg));
    }
    return this.play(el, {
      src: src,
      frameWidth: f0.w,
      frameHeight: f0.h,
      frames: frames.length,
      fps: fps,
      mode: o.mode || "css",
      loop: o.loop,
    });
  },
};
