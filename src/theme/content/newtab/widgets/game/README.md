# Minigame widget

A pocket world: a landscape, a companion that wanders it, three needs that
drain in real time, and a story that unlocks by the day. It is deliberately a
**scaffold** — every visual is a placeholder and every rule is data — so the
art, the animations and the plot are yours to grow without touching `game.js`.

## What it does today

- **Scene:** `landscape.png` is drawn at an integer pixel scale to fit the tile
  (letterboxed in `--bg`), so pixel art stays crisp at any widget size.
- **Companion:** `player.png` + `player.json` (Aseprite export with frame
  **tags** `idle` and `walk`). Click anywhere on the ground to walk there;
  arrow keys / WASD move it while the canvas has focus. It faces the way it
  walks.
- **Needs (Tamagotchi):** fullness / energy / mood, 0–100, drain at
  `decayPerHour` from `game.json` using real elapsed time (the save carries a
  timestamp, so it keeps draining while the browser is closed). **Feed / Play /
  Rest** in the top bar restore them.
- **Days:** counted from the moment the save was created.
- **Story:** `story.json` chapters unlock when their `when` matches — by day
  and/or by a flag an earlier chapter `sets`. The dialogue box pages through
  `lines`. A chapter is shown once; `seen` and `flags` live in the save.
- **Save:** everything persists in the widget's config (IndexedDB). Remove the
  tile to start over.

## Art slots

```
assets/
  landscape.png   any size; drawn to fit. Placeholder 192x108.
  player.png      horizontal strip; frame size/count from player.json.
  player.json     Aseprite JSON with meta.frameTags: "idle", "walk"
                  (add "sleep", "eat", "happy" later; see below)
  game.json       spawn point, walkable rectangle (world px), speed (px/s),
                  companion name, decay rates
  story.json      chapters (see above)
  icon.png        16x16 palette icon
```

Export from Aseprite with *File → Export Sprite Sheet*: **Horizontal** strip,
**JSON data** on, **Tags** on (so `frameTags` is written). Frame durations are
honoured per frame here, unlike the CSS sprite helper.

## Where to take it next (the code is ready for these)

- More animation tags: the player looks up `sleep`, `eat`, `happy` by name and
  falls back to `idle` when a tag is missing, so add them to the sheet and the
  actions start using them.
- A bigger world: `walkable` can be any rectangle; swap the background for a
  wider one and raise `speed`.
- Plot: chapters can gate on any flag, and `sets` can add several — build a
  branching arc entirely in `story.json`.
- Encounters: the natural next step is a `creatures` list in `game.json` with
  their own sheets, spawned on the walkable area on a timer.
