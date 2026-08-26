# ambient-theme

Rethemes the browser from three **locally-computed** (or cheaply-fetched) inputs.
It never hardcodes a color: `ambient-theme.js` only sets **attributes on `:root`**,
and `ambient-theme.css` re-assigns the **A2 theme variables** (from `theme.css`) per
variant. The chrome already reads `var(--bg)`, `var(--accent)`, … so it just follows.

```
                 ┌── time of day  → attr  cthulhu-ambient-time="dawn|day|dusk|night"
  inputs ────────┼── weather      → attr  cthulhu-ambient-weather="clear|cloudy|rain|snow|storm"
                 └── moon phase   → art   #cthulhu-ambient-celestial background frame
```

## 1. How the retheme happens (the swap)

`ambient-theme.js` computes a variant and does **only** this:

```js
document.documentElement.setAttribute("cthulhu-ambient-time", "dusk");
```

`ambient-theme.css` holds the palettes. Because `:root[attr="…"]` outranks the base
`:root` in `theme.css`, the matching block wins and every A2 token is swapped:

```css
:root[cthulhu-ambient-time="dusk"] { --bg: #241a16; --accent: #e08a4a; /* … */ }
```

## 2. Variant → variable mapping

### Time of day — swaps the whole base palette

| variant | when (local solar) | `--bg` | `--accent` | `--fg` | mood |
|---------|--------------------|--------|-----------|--------|------|
| `dawn`  | ±1 h around sunrise | `#241a24` warm plum | `#e39a7a` coral | `#f3e7ea` | soft warm sunrise |
| `day`   | sunrise+1h → sunset−1h | `#eceef2` light | `#2f8f76` teal | `#1b1e26` | bright light theme |
| `dusk`  | ±1 h around sunset | `#241a16` warm brown | `#e08a4a` orange | `#f3e9df` | golden-hour |
| `night` | otherwise | `#14151c` blue-black | `#6c8cff` blue | `#e6e8f0` | dark, moonlit |

Each block also re-assigns `--bg-elevated`, `--surface`, `--surface-hover`,
`--fg-muted`, `--accent-hover`, `--fg-on-accent`, `--grid-line`, `--border` — the
full A2 token set (see `ambient-theme.css`). Tune the hex values to taste; the
**mapping** (which variant sets which token) is the contract.

### Weather — small **derived** tweaks + an animated overlay

Weather layers on top of the time-of-day palette. Tweaks are `color-mix()`ed **from
the current A2 tokens** (never a fresh hardcoded color), so they track whatever
time-of-day is active:

| group | source codes (WMO) | variable tweak | overlay |
|-------|--------------------|----------------|---------|
| `clear`  | 0–1 | none | none |
| `cloudy` | 2, 3, 45, 48 | `--accent` → mixed toward `--fg-muted` | none |
| `rain`   | 51–67, 80–82 | none | `rain.png` (sprite helper) |
| `snow`   | 71–77, 85, 86 | none | `snow.png` (sprite helper) |
| `storm`  | 95–99 | `--bg` darkened, `--accent` muted | `rain.png` |

Overlays mount `#cthulhu-ambient-overlay` (full-window, `pointer-events:none`) and
are animated by the **A4 sprite helper** (`window.CthulhuSprite.fromAseprite`).

### Moon phase — moved out of this module

The sun/moon celestial element (`#cthulhu-ambient-celestial`) was removed. The
moon is now a home-page widget: `content/newtab/widgets/moon/moon.js`, which
calls the shared `moonEl()` helper in `content/newtab/widgets.js` and draws from
the shared 8-frame strip at `content/newtab/assets/moon.png`.

Replace that file to restyle the moon. There is no moon or sun art in this
module any more.

## 3. Configuration (prefs)

| pref | type | default | meaning |
|------|------|---------|---------|
| `cthulhu.ambient.latitude`  | string | *(unset)* | your latitude, e.g. `40.71` |
| `cthulhu.ambient.longitude` | string | *(unset)* | your longitude, e.g. `-74.01` |
| `cthulhu.ambient.geolocation` | bool | `false` | if lat/long unset, try geolocation |
| `cthulhu.ambient.weather.cache` | string | *(auto)* | JSON weather cache (managed by the module) |
| `cthulhu.module.ambient-theme.enabled` | bool | `true` | master on/off (loader convention) |

**Location precedence:** explicit lat/long pref → geolocation (if enabled) →
built-in placeholder (`40.71, -74.01`, NYC). Set the prefs for correct results.

## 4. Refresh & offline behaviour

- Time band re-evaluated every **5 min**; weather every **30 min**.
- Weather is cached in a pref; a fresh cache (<30 min) is reused with no fetch,
  so multiple windows share one request.
- **Offline / fetch failure is non-fatal:** the weather attribute/overlay is
  simply dropped and the browser stays on the plain time-of-day theme.

## 5. Art slots (drop your own; keep sizes or update the constants)

```
assets/
  rain.png    128×32 (4 × 32)    — rain overlay sheet   + rain.json (Aseprite)
  snow.png    128×32 (4 × 32)    — snow overlay sheet   + snow.json (Aseprite)
```

(The moon strip is not here — see "Moon phase" above.)

Overlay sheets follow the same Aseprite export convention as the other modules
(see `theme/assets/README.md`): horizontal strip, JSON Hash/Array with frame
durations and `meta.image`. The placeholders here are crude — replace freely.

## 6. Notes

- Everything except weather is computed locally (no API, no key) from the date +
  lat/long. Weather uses **Open-Meteo** (free, no key).
- Cross-platform: no OS-specific paths; the solar/moon math and Open-Meteo call
  are platform-neutral. Re-verify the overlay look in the post-Phase-8 shakedown.
