# Cthulhu feature modules

Self-contained browser features. Each module lives in its own folder and is
discovered + injected into the browser chrome at startup by the loader
(`../loader.js`), which is bootstrapped from `../browser.js`.

Everything here is packaged under `chrome://cthulhu/content/modules/` (see
`theme/jar.mn`).

## Folder convention

```
modules/
  index.json                 # registry: a JSON array of module ids to load
  <feature>/
    manifest.json            # { id, enabled, mount, css, js }
    <feature>.js             # chrome JS (IIFE; runs in the browser-window scope)
    <feature>.css            # chrome CSS (consume theme.css tokens; no hardcoded colors)
    assets/                  # module art -> chrome://cthulhu/content/modules/<feature>/assets/<file>
```

### manifest.json

```json
{
  "id": "<feature>",          // must match the folder name
  "enabled": true,            // ship default (see "Toggling" below)
  "mount": "browser-window",  // where it attaches: "browser-window" | "all"
  "css": "<feature>.css",     // omit to inject no CSS
  "js": "<feature>.js"        // omit to inject no JS
}
```

`mount` is matched against the loader's window context (currently
`"browser-window"`). Use `"all"` to load regardless; other contexts can be added
to the loader later.

## Toggling a module on/off

Effective state = the pref **`cthulhu.module.<id>.enabled`** if it is set on any
branch, otherwise `manifest.enabled`. So:

- **Ship default:** set `"enabled"` in `manifest.json`.
- **Per-user, no rebuild:** flip `cthulhu.module.<id>.enabled` in `about:config`.
- **Ship a default override:** add `pref("cthulhu.module.<id>.enabled", false);`
  to `src/browser/app/profile/cthulhu.js`.

Changes take effect on the next browser window / restart. Inspect what loaded at
runtime via `window.CthulhuLoader.loaded` and `window.CthulhuLoader.skipped`.

## Add a new module — exact steps

1. Copy the scaffold and rename:
   ```
   cp -R modules/example modules/<feature>
   mv modules/<feature>/example.js  modules/<feature>/<feature>.js
   mv modules/<feature>/example.css modules/<feature>/<feature>.css
   ```
2. Edit `modules/<feature>/manifest.json` — set `id` (= folder name), `mount`,
   `css`, `js`.
3. Add `"<feature>"` to `modules/index.json`.
4. Register the files in `theme/jar.mn` (jar.mn does **not** glob — list each
   file explicitly):
   ```
   content/modules/<feature>/manifest.json  (content/modules/<feature>/manifest.json)
   content/modules/<feature>/<feature>.js    (content/modules/<feature>/<feature>.js)
   content/modules/<feature>/<feature>.css   (content/modules/<feature>/<feature>.css)
   ```
   (plus any `assets/` files the module ships.)
5. Rebuild: `surfer build`. The module now loads at chrome startup.
