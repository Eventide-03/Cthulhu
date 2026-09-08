# Pet widget

A looping pixel pet. Pick a specific one, or leave it on **Random** — which
re-rolls on every render: each new tab, each home-page refresh, and on a click
on the tile.

## The pets

| id | frames | what it does |
| --- | --- | --- |
| `verity` | 1 | idles |
| `kiy` | 12 | **glitches** — see below |
| `rishi` | 1 | idles; **click him to send a feature request** |
| `cthulhu` | 1 | idles |
| `voyeur` | 1 | idles |
| `cat` | 1 | idles |

## Art slots (drop your own)

Every pet is one entry in `assets/pets.json` plus its PNG frame(s) in
`assets/`. Adding a pet never means editing `pet.js`:

```json
{ "id": "cat", "name": "Cat", "frames": ["cat.png"] }
```

- **`frames`** — one or more PNGs, each a single frame at **native pixel
  size**. Frames can be any size; 16×24, 32×32, 56×62 and 64×64 all ship
  today. The widget scales each pet up by an **integer** factor to fill the
  tile (`image-rendering: pixelated`, so it stays crisp) and re-fits when the
  tile is resized. Never pre-scale the art.
- **`mode`** — omitted: one frame plays a gentle idle bob; several frames play
  in order at `fps`. `"glitch"`: see below.
- **`fps`** — playback rate for multi-frame pets (default 8; glitch default 11).
- **`action`** — `"feature-request"` turns the sprite into a real button that
  opens the feature-request form (`rishi-request.js`, loaded on first click).
- **`hint`** — tooltip for an actionable pet; also shown under the ⚙ dropdown.

Then add the new files to `theme/jar.mn` (it does not glob) and rebuild.

## KIY — the King in Yellow

Something spooky, on purpose:

- Its twelve frames play in a **random order**, reshuffled every pass, so every
  frame shows once per pass and none repeats back to back, with a pixel of
  jitter thrown in.
- Its **name never sits still**. Under the sprite and in the ⚙ dropdown, "KIY"
  flickers into a few characters of gibberish — Greek, Cyrillic, Hebrew,
  katakana, runes, block glyphs — and back, several times a second. It is
  legible as a whole because the real name shows about two ticks in five.

## Rishi — the feature-request box

Rishi is wrapped in a real `<button>`. GridStack does not start a tile drag
from a button, so a plain click reaches him — unlike the rest of a tile, where
clicks have to be inferred from a drag that went nowhere (see
`widgets/README.md`). Clicking him opens the same form the toolbar button does:
message, optional name, sent to the relay in `relay/`. The former standalone
feature-request widget is gone; this is where it lives now.

## Rishi's mood (admin panel)

Rishi carries a `moodPref` in `pets.json`, so whatever that pref holds is drawn
in a speech bubble **above** his sprite, and follows the pref live — set it and
every open tab updates without a reload. Any pet can have one; only Rishi does.

Set it in the **admin panel**: turn on `cthulhu.admin.enabled` in `about:config`
and an *admin* button appears beside the widget-settings gear. The section
offers six presets and a free-text field; **Clear** removes the bubble.

The section is registered from `pet.js` rather than from `admin.js`, so the
control ships beside the thing it controls and the panel never needs editing to
gain one. See the header of `newtab/admin.js`.

**It is local to your machine.** The admin gate is discoverability, not
security — the source is public, so anyone can flip that pref for their own
copy. That is fine while everything in the panel only affects the machine it
runs on. A mood your *friend* could see would need a server to hold it plus a
secret you supply, because anything shipped inside a public binary is
extractable.

A pet whose art fails to load shows its name rather than an empty tile; a
configured pet that has been removed from `pets.json` falls back to a random
one.
