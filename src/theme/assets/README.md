# Assets & sprite pipeline

How Aseprite exports get into the browser, and how animated sprites play.

## Where art goes (drop folders)

| Scope | Folder | URL |
|-------|--------|-----|
| **Per-module art** | `content/modules/<feature>/assets/` | `chrome://cthulhu/content/modules/<feature>/assets/<file>` |
| Chrome-wide art | `content/assets/` (this folder) | `chrome://cthulhu/content/assets/<file>` |

Every asset must **also be listed in `theme/jar.mn`** (jar.mn does not glob), then
rebuild (`surfer build`).

## Naming convention

- Lowercase-kebab, descriptive: `idle.png`, `walk.png`, `logo.png`.
- **Animated sprite** = a PNG sheet + a JSON of the same base name: `idle.png` + `idle.json`.
- **Static image** = just `<name>.png`.
- Pixel art: author at 1× native size, transparent background (RGBA). Scaling stays
  crisp automatically (`image-rendering: pixelated`).

## Aseprite export (File → Export Sprite Sheet)

- **Sheet Type: `Horizontal`** — all frames in one row, left → right. The playback
  helper assumes a horizontal strip of uniform-size frames.
- **Constant frame size:** leave **Trim** OFF so every frame is the same size;
  Border/Spacing/Padding = 0.
- **Output → Output File:** `<name>.png`, saved into the module's `assets/`.
- **Output → JSON Data:** ON. Type **`Hash`** or **`Array`** (both supported).
  Enable **Frame Duration** (lets the helper derive fps) and keep **Meta → Image**
  (so the helper finds the PNG next to the JSON).
- Result: `<name>.png` (the sheet) + `<name>.json` (`frames` + `meta.image` + durations).

## Playing a sprite

Helper: `content/sprite.js` (global `window.CthulhuSprite`), styles: `content/sprite.css`.
Both load at chrome startup, so any module can use them.

```js
const el = document.createElement("div");
host.appendChild(el);

// Easiest — derive frame size/count/fps from the Aseprite JSON:
CthulhuSprite.fromAseprite(
  el,
  "chrome://cthulhu/content/modules/<feature>/assets/idle.json",
  { mode: "css" }            // "css" = steps() animation, "js" = interval stepping
);

// Or fully explicit (no JSON needed):
CthulhuSprite.play(el, {
  src: "chrome://cthulhu/content/modules/<feature>/assets/idle.png",
  frameWidth: 16, frameHeight: 16, frames: 4, fps: 8, mode: "css", loop: true,
});
```

Both return a controller: `const c = CthulhuSprite.play(...); c.stop();`

- **`mode: "css"`** — a single shared `@keyframes cthulhu-sprite-play` steps the
  background across the strip. GPU-friendly, set-and-forget.
- **`mode: "js"`** — a `setInterval` frame-stepper (handy when you need to react
  to frames or drive playback from code).

## Placeholders (shipped for testing before you supply real art)

In `content/modules/example/assets/`:
- `idle.png` + `idle.json` — a 4-frame 16×16 horizontal strip (a teal square orbiting).
- `logo.png` — a static 16×16 image.

The `example` module plays `idle` as a floating demo badge. Replace these with your
Aseprite exports (same names) and it just works.
