# Pet widget

An idle-looping pixel pet. Pick a specific one, or leave it on **Random** —
which re-rolls on every render: each new tab, each home-page refresh, and on a
click on the tile.

## Art slots (drop your own; the bundled four are placeholders)

Every pet is two files plus one line of manifest — the same drop-in convention
the widget registry itself uses. Adding a pet never means editing `pet.js`:

```
assets/
  <id>.png      horizontal strip: N frames of equal size, left to right
  <id>.json     Aseprite-format sheet JSON (frame rects + per-frame durations;
                `meta.image` names the PNG, resolved next to the JSON)
  pets.json     [{ "id": "<id>", "name": "<Display Name>" }, ...]
```

The bundled `cat` / `dog` / `frog` / `ghost` are crude 4-frame 32×32 strips
(128×32) — flat shapes meant to be thrown away.

**Frame size and count are read from each pet's own JSON**, so real art is free
to use a different cell size or a longer animation without any code change. The
sprite is scaled up 3× for display (`transform: scale(3)`, `image-rendering:
pixelated`), so a 32×32 cell renders at 96×96 — draw at native pixel size, not
pre-scaled.

If you export from Aseprite, *File → Export Sprite Sheet* with **horizontal
strip** layout and **JSON data** checked produces exactly this pair.

### Minimal hand-written JSON

```json
{
  "frames": {
    "cat 0.aseprite": { "frame": { "x": 0,  "y": 0, "w": 32, "h": 32 }, "duration": 220 },
    "cat 1.aseprite": { "frame": { "x": 32, "y": 0, "w": 32, "h": 32 }, "duration": 220 }
  },
  "meta": { "image": "cat.png", "format": "RGBA8888",
            "size": { "w": 64, "h": 32 }, "scale": "1" }
}
```

`duration` is per frame in milliseconds; the sprite helper averages them into
one playback rate (it drives a CSS `steps()` animation, so the strip plays at a
single fps rather than honouring per-frame timing individually).

A pet whose art fails to load falls back to showing its name with
"(art missing)" rather than rendering an empty tile; a configured pet that's
been deleted from `pets.json` falls back to a random one.
