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
    assets/             optional art (spritesheets, icons)
```

## The widget definition

```js
CthulhuWidgets.register({
  id: "my-widget",              // unique; also the folder name + asset namespace
  category: "utility",          // "utility" | "aesthetic" (a new category just works)
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

**Theme with A2 variables only** (`var(--bg)`, `var(--surface)`, `var(--accent)`,
`var(--fg)`, `var(--grid-line)`, `var(--font-pixel)`, …) — never hardcode a color.

## Add a widget in 3 steps

1. Create `widgets/<id>/<id>.js` (+ `assets/`) with a `CthulhuWidgets.register({...})` call.
2. Add `"<id>"` to `widgets/index.json`.
3. Add the file(s) to `theme/jar.mn` (jar.mn does not glob), then rebuild.

It appears in the palette under its category automatically; dragging it onto the
grid, removing it, and persisting its position/size/config are all handled by the
core. Layout persists to IndexedDB and survives restarts; **Reset layout** (drawer
footer) restores the default set.
