# Home-page widgets

Widgets live on the `about:cthulhu` dashboard grid (GridStack). The system mirrors
the chrome **feature-module** convention: each widget is a self-contained folder
that self-registers into a shared registry, and the palette auto-populates from
whatever is registered — you never edit the core (`newtab/widgets.js`) to add one.

```
widgets/
  index.json            ["clock", "quick-links", …]  ← load order / discovery
  <id>/
    <id>.js             calls CthulhuWidgets.register({...})
    assets/
      icon.png          ART SLOT: 16x16 palette icon (shown in the drawer
                        instead of a dot; a missing file falls back to the dot)
      …                 spritesheets, other art
```

## The widget definition

```js
CthulhuWidgets.register({
  id: "my-widget",              // unique; also the folder name + asset namespace
  category: "utility",          // "utility" | "aesthetic" | "play" (a new category just works)
  icon: "icon.png",             // optional; default is assets/icon.png
  name: "My Widget",            // shown in the palette
  defaultSize: { w: 3, h: 2 },  // in grid cells
  defaultConfig: { foo: 1 },    // per-instance config seed (persisted)
  css: `.cw-mine { color: var(--fg); }`,   // optional; injected once, use A2 vars

  render(body, ctx) {           // REQUIRED — build DOM into `body`
    body.innerHTML = `<div class="cw-mine">${ctx.esc(ctx.config.foo)}</div>`;
    const iv = setInterval(/* … */, 1000);
    ctx.onCleanup(() => clearInterval(iv));   // clean up timers/animations
  },

  animate(body, ctx) {          // OPTIONAL — uses the A4 sprite helper
    ctx.sprite.fromAseprite(body.querySelector(".s"), ctx.assetUrl("anim.json"), { mode: "css" })
      .then(ctrl => ctx.onCleanup(() => ctrl.stop()));
  },

  configUI(panel, ctx) {        // OPTIONAL — renders a config popover (⚙ button)
    panel.innerHTML = `<input type="number">`;
    panel.querySelector("input").addEventListener("change", e =>
      ctx.saveConfig({ ...ctx.config, foo: +e.target.value }, { refresh: true }));
  },

  onClick(ctx) {                // OPTIONAL — fires on a genuine click on the
    // widget body (GridStack is drag-enabled on the whole tile, so it starts
    // a real drag on the first pointer movement and swallows the native
    // `click`; the core detects "dragged then dropped in the same cell" and
    // calls this instead — don't rely on your own click/mouseup listeners
    // for whole-tile-clickable content, e.g. a link tile like quick-links).
  },
});
```

## The `ctx` passed to render / animate / configUI

| member | purpose |
|---|---|
| `ctx.config` | this instance's current config object |
| `ctx.saveConfig(cfg, {refresh})` | persist new config; `refresh:true` re-renders the widget |
| `ctx.refresh()` | re-render the widget body now |
| `ctx.onCleanup(fn)` | register teardown (intervals, sprite `.stop()`) — run on remove/re-render |
| `ctx.sprite` | the A4 helper (`window.CthulhuSprite`) for `animate()` |
| `ctx.moon` | moon helpers: `ctx.moon.moonPhase(date)` → `{frac,frame,name}`; `ctx.moon.moonEl(date,size)` → a pixel moon element |
| `ctx.assetUrl(path)` | resolves `widgets/<id>/assets/<path>` to a chrome URL |
| `ctx.esc(str)` | HTML-escape a string |
| `ctx.isHome` | `true` on the home page (`about:cthulhu#home`, the single pinned tab the Home button toggles to) |
| `ctx.openLink(url)` | navigate the user to `url` — a new tab on the home page (so the pinned tab is never navigated away and lost), in place on an ordinary new tab. Use this instead of `location.href = url` for anything a widget sends the user to. |
| `ctx.pickImage()` | the recent-files / clipboard / browse image picker → data URL (or null) |
| `ctx.theme` | the browser-wide theme engine (`content/themes.js`): `current()`, `presets()`, `tokens()` (the live palette as hex — e.g. `tokens().accent`), `setTheme(id)`, favourites, and `.color` helpers (`hexToHsl`, `mix`, `onColor`, …). The document fires `cthulhu-theme-change` whenever the palette changes; listen to it if you cache a colour. |
| `ctx.ui` | shared config-panel controls, all `createElement`: `checkRow`, `textRow`, `selectRow`, `rangeRow`, `colorRow` (native picker + hex, kept in sync), `swatches` (preset chips), `field` (a captioned group), `button`, `toast`. Use these so every widget's ⚙ panel looks the same. |
| `ctx.openConfig()` / `ctx.closeConfig()` | open / close this tile's ⚙ panel from inside the widget |

## Hover tools (⚙ / ×) and your layout

The core draws the two hover buttons on the grid **item**, straddling the tile's
top border: 8px above it and 12px below — exactly the tile's top padding. So
they never cover anything you draw, and you do **not** need to reserve space in
the top-right corner for them. (They used to sit inside the tile, on top of
whatever was there; the calendar's own header buttons were unreachable.)

**Theme with A2 variables only** (`var(--bg)`, `var(--surface)`, `var(--accent)`,
`var(--fg)`, `var(--grid-line)`, `var(--font-pixel)`, …) — never hardcode a color.

## ⚠️ Build controls with `createElement`, not `innerHTML`

`about:cthulhu` runs with the **system principal**, so assigning `innerHTML`
goes through Gecko's chrome-fragment sanitizer, which **silently drops
interactive elements** — `<button>`, `<input>` and `<select>` all disappear
from the resulting tree with no error thrown:

```js
d.innerHTML = "<span>keep</span><button>gone</button><input><select></select>";
// -> "<span>keep</span>"   (only inert nodes survive; <textarea> does too)
```

Use `innerHTML` for inert structure (divs, spans, text) if you like, but every
control must be `document.createElement("button")` etc. This is easy to miss
because it fails *quietly* — the widget renders, just without its buttons.

## Add a widget in 3 steps

1. Create `widgets/<id>/<id>.js` (+ `assets/icon.png`, any other art) with a `CthulhuWidgets.register({...})` call.
2. Add `"<id>"` to `widgets/index.json`.
3. Add the file(s) to `theme/jar.mn` (jar.mn does not glob), then rebuild.

## Replacing the placeholder art

Every icon and every sprite the widgets ship with is a placeholder. Overwrite
the file in place (same path, same name) and rebuild — nothing else to edit.
`tools/make-placeholder-art.mjs` is what generated them; it shows the intended
formats (icons 16×16; sheets as horizontal Aseprite strips).

It appears in the palette under its category automatically; dragging it onto the
grid, removing it, and persisting its position/size/config are all handled by the
core. Layout persists to IndexedDB and survives restarts; **Reset layout** (drawer
footer) restores the default set.
