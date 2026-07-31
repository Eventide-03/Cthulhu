/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Orb widget (aesthetic, animated). Plays a placeholder spritesheet via the A4
 * sprite helper (window.CthulhuSprite). Drop real art at assets/orb.png + .json. */
CthulhuWidgets.register({
  id: "orb",
  category: "aesthetic",
  name: "Orb",
  defaultSize: { w: 2, h: 2 },
  defaultConfig: {},
  css: `
    .cw-orb { display:flex; align-items:center; justify-content:center; height:100%; }
    .cw-orb .cthulhu-sprite { transform:scale(3); image-rendering:pixelated; }
  `,
  render(el) {
    el.innerHTML = '<div class="cw-orb"><div class="cw-orb-sprite"></div></div>';
  },
  animate(el, ctx) {
    const sprite = el.querySelector(".cw-orb-sprite");
    if (!ctx.sprite || !sprite) return;
    ctx.sprite
      .fromAseprite(sprite, ctx.assetUrl("orb.json"), { mode: "css" })
      .then((ctrl) => ctx.onCleanup(() => ctrl && ctrl.stop && ctrl.stop()))
      .catch((e) => console.warn("[Cthulhu:orb] sprite:", e.message));
  },
});
