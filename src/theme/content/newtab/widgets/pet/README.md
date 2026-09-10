# Pet widget

A looping pixel pet. Pick a specific one, or leave it on **Random** — which
re-rolls on every render: each new tab, each home-page refresh, and on a click
on the tile.

## The pets

| id | frames | what it does |
| --- | --- | --- |
| `verity` | 1 | idles |
| `kiy` | 12 | **glitches** — see below |
| `rishi` | 1 | idles; **click him to send a feature request**; only one per page; can be **Tea** |
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
  size**. Frames can be any size; 16×24, 18×30, 32×32, 56×62 and 64×64 all
  ship today. The widget scales each pet up by an **integer** factor to fill
  the tile (`image-rendering: pixelated`, so it stays crisp) and re-fits when
  the tile is resized. Never pre-scale the art.
- **`mode`** — omitted: one frame plays a gentle idle bob; several frames play
  in order at `fps`. `"glitch"`: see below.
- **`fps`** — playback rate for multi-frame pets (default 8; glitch default 11).
- **`action`** — `"feature-request"` turns the sprite into a real button that
  opens the feature-request form (`rishi-request.js`, loaded on first click).
- **`hint`** — tooltip for an actionable pet; also shown under the picker.
- **`unique`** — only one tile per page may show this pet (see Rishi).
- **`moodPref`** / **`variantPref`** / **`variants`** — see Rishi.

Then add the new files to `theme/jar.mn` (it does not glob) and rebuild.

## KIY — the King in Yellow

Something spooky, on purpose:

- Its twelve frames play in a **random order**, reshuffled every pass, so every
  frame shows once per pass and none repeats back to back, with a pixel of
  jitter thrown in.
- Its **name never sits still**. Under the sprite and in the picker, "KIY"
  flickers into a few characters of gibberish — Greek, Cyrillic, Hebrew,
  katakana, runes, block glyphs — and back, several times a second. It is
  legible as a whole because the real name shows about two ticks in five.

## Rishi

### The feature-request box

Rishi is wrapped in a real `<button>`. GridStack does not start a tile drag
from a button, so a plain click reaches him — unlike the rest of a tile, where
clicks have to be inferred from a drag that went nowhere (see
`widgets/README.md`). Clicking him opens the feature-request form: message,
optional name, sent to the relay in `relay/`. There is no other feature-request
entry point any more — the toolbar button and the standalone widget are both
gone; this is where it lives.

### There can only be one Rishi at a time

`"unique": true` in `pets.json`. One tile per page may show him: a second tile
set to Rishi says **"There can only be one Rishi at a time"** where the sprite
would be, the picker refuses him (same message, as a toast) and marks his row
*on another tile*, and **Random** never rolls him while another tile has him.
The home page and a new tab are different pages, so each gets its own one —
one on the home page, one on the tab board.

### Rishi or Tea (admin panel)

Rishi carries `"variantPref": "cthulhu.pet.rishi.variant"` and one variant,
`tea` (`assets/tea.png`, 18×30 like `rishi.png`). While the pref says `tea`
every Rishi tile is drawn as **Tea** — same button, same bubble, different
sprite and name — and it follows the pref live. The admin panel's **Switch to
Tea / Switch back to Rishi** button flips it.

### Rishi's mood (admin panel)

Rishi carries `"moodPref": "cthulhu.pet.rishi.mood"`; whatever that pref holds
is drawn in a speech bubble **above** his sprite, live.

Both values are **shared between the two browsers**, and this is how:

- The relay (`relay/worker.js`) holds them: `GET /rishi` returns
  `{ mood, variant }`. Any page with a Rishi tile polls it once a minute (and
  when the tab becomes visible again) and writes the answer into the two
  prefs. Every tile follows the prefs, so all open tabs update together.
- The **admin panel** (`cthulhu.admin.enabled` in `about:config`, then the
  *admin* button beside the widget-settings gear) writes the prefs directly —
  your own machine updates instantly — **and** `PUT`s to the relay with the
  admin token, so the other browser picks it up on its next poll. Six presets,
  a free-text field, **Clear**, and the Tea switch.
- A relay value is applied only when it is **new**: every relay write carries
  a timestamp, each profile remembers the last one it applied, and a poll that
  returns the same stamp changes nothing. So a value set locally stays until a
  relay write arrives, and a relay nobody has written to yet changes nothing.
- Without a token the panel says *Saved here only* and changes your machine
  alone (until the owner's next relay write, which then wins). The token is `ADMIN_TOKEN` on the relay (`wrangler secret put
  ADMIN_TOKEN`, see `relay/README.md`), typed once into the panel's **Relay**
  section, and kept in `cthulhu.admin.token` in your profile. It is the only
  thing that lets anyone change what the other person sees, which is exactly
  why it is not in the source or the binary.

Why it used to be local: there was nowhere to hold a value both browsers could
read, and no secret to prove who may change it. The relay now provides both.
The `cthulhu.admin.enabled` gate itself is still only discoverability — the
source is public — and that is fine, because a copy with the panel switched on
and no token can change nothing for anyone else.

The section is registered from `pet.js` rather than from `admin.js`, so the
control ships beside the thing it controls. See the header of `newtab/admin.js`.

A pet whose art fails to load shows its name rather than an empty tile; a
configured pet that has been removed from `pets.json` falls back to a random
one.
