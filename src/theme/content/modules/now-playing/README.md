# Now Playing

A toolbar squircle (~135×25px, left of the extensions button) showing whatever
media is playing in any tab, and a dropdown player under it:

```
[ Title                          × ]
[ Artist                           ]
[ 0:15 ━━━━━━━━━━━━━━━━━━━━ 3:53   ]
[      |<    ||    >|    🔊        ]
```

Title and artist (click them to jump to the tab that is playing), a seekable
progress bar with elapsed / total time, previous, play/pause, next, and mute.
That is all it does. The former side-panels module — Discord / Instagram /
Apple Music toggles, the embedded sidebar, the browse shortcuts and the search
bar — is gone; this is what remained of it.

## How it reads what's playing

Every tab's chrome-only `browsingContext.mediaController` (title / artist /
position, per `MediaController.webidl`) is polled once per window every 250 ms
— a handful of boolean reads — and the best candidate (playing beats paused,
audible beats silent) feeds both the squircle and the dropdown from one shared
tracker. There is no built-in "any tab" event for this; the closest one is
gated behind a testing-only pref.

Transport controls call straight into that controller (`play` / `pause` /
`prevTrack` / `nextTrack` / `seekTo`). Previous/next are disabled when the
page does not declare those actions. There is **no volume-level API** on
`MediaController` at all, so the speaker button toggles the tab's own mute
flag rather than pretending to be a slider.

## Icons (art slots)

| file | shows | size |
| --- | --- | --- |
| `assets/prev.png` | previous track | 16×16 |
| `assets/play.png` / `assets/pause.png` | the play/pause chip swaps between them | 16×16 |
| `assets/next.png` | next track | 16×16 |
| `assets/volume.png` / `assets/mute.png` | the mute button swaps between them | 16×16 |
| `assets/close.png` | close, top-right | 16×16 |

All drawn **1:1 at 16×16** and rendered at 16 CSS px with
`image-rendering: pixelated` (a 2× display shows each pixel as a crisp 2×2
block). Overwrite in place and rebuild — nothing else to edit. The shipped
ones are placeholders from `tools/make-placeholder-art.mjs --only=player`.

## Files

```
now-playing.js            toolbar item + shared media tracker + dropdown player
NowPlayingWidget.sys.mjs  once-per-process CustomizableUI registration
now-playing.css           A2-themed squircle + player
assets/                   the icon slots above
```

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.now-playing.enabled`.
The CustomizableUI widget id is still `cthulhu-nowplaying`, so a profile that
already had it placed keeps its position.
