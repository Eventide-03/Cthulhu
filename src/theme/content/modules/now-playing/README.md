# Now Playing

A toolbar squircle (~135×25px, left of the extensions button) showing whatever
media is playing in any tab, and a player card:

```
[ Title                          × ]
[ Artist                           ]
[ 0:15 ━━━━━━━━━━━━━━━━━━━━ 3:53   ]
[      |<    ||    >|    🔊 ━━━━   ]
```

Title and artist (click them to jump to the tab that is playing), a seekable
progress bar with elapsed / total time, previous, play/pause, next, and a
speaker: **click it to mute** the tab, **hover it for the volume slider**.
That is all it does. The former side-panels module — Discord / Instagram /
Apple Music toggles, the embedded sidebar, the browse shortcuts and the search
bar — is gone; this is what remained of it.

The card lives in two places: a dropdown under the squircle, and — while
compact mode is on — **docked at the bottom of the sidebar column**
(`modules/compact-mode` asks for it via `window.CthulhuNowPlaying.dock()`),
where the squircle is hidden.

## Why it does not flicker

The first version redrew everything four times a second from a poll that
"notified" whether or not anything had changed, and fed the bar extrapolated
positions that the tab's own position events kept correcting backwards by a
few hundred ms — so the bar and the elapsed label wobbled. Now the tracker
notifies only on a real change (a different tab, or a metadata / playback /
position event), the cards run their own 1 Hz clock for the bar with a 1 s
linear transition so it glides, a displayed position never moves backwards
by less than two seconds (that is jitter, not a seek), and nothing in the DOM
is written unless its value changed.

## Mute and volume, honestly

**Mute** is the tab's own `toggleMuteAudio()` — the same thing the speaker on
a tab does. (The old code assigned `browser.audioMuted`, which is getter-only
and throws in strict mode; that is why it did nothing.)

**Volume** has no chrome API in Gecko: nothing on `MediaController`,
`BrowsingContext` or `nsIDOMWindowUtils` sets a tab's level. So the slider
works on the page's `<audio>` / `<video>` elements through a small content
actor (`CthulhuTabVolumeParent/Child.sys.mjs`, registered from
`NowPlayingWidget.sys.mjs`): the level is kept in a map the parent module
exports, keyed by the tab's `browserId` (the one thing an actor can read off
its browsing context — from inside an actor module the `<browser>`'s
`ownerGlobal` is not reachable, measured), pushed to every live frame, and
applied to every media element that exists and to each one that starts
playing later; a fresh document (reload, navigation) asks for its tab's level
on `pageshow`, so it survives both. Two limits worth knowing: a page with its
own volume control can set the element's volume again afterwards (the
slider's next move sets it back), and a Web Audio player has no media element
and is unaffected. Sliding up from zero un-mutes.

On a **local dev bundle** the child module is a symlink out of the bundle,
which the sandboxed content process cannot read — so the slider stores the
level but the page does not follow until a packaged build (omni.ja), exactly
like the file-picker child. The Marionette suite prints an INFO line for this
rather than failing.

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

| file | shows | drawn at |
| --- | --- | --- |
| `assets/play.png` / `assets/pause.png` | the play/pause chip swaps between them | 17×17 / 17×16 |
| `assets/skip.png` | next track — and, **mirrored**, previous | 23×17 |
| `assets/sound1.png` | speaker, volume above ⅔ (three arcs) | 16×16 |
| `assets/sound2.png` | speaker, ⅓–⅔ (two arcs) | 16×16 |
| `assets/sound3.png` | speaker, up to ⅓ (one arc) | 16×16 |
| `assets/mute.png` | speaker, muted or at 0 | 16×16 |
| `assets/close.png` | close, top-right | 16×16 |

Every icon is shown at **its own size, 1:1**, with `image-rendering:
pixelated` — nothing is scaled into a fixed box, so the sizes above are just
what the current art happens to be, not a requirement; redraw at any size up
to about 24×24 (the transport buttons are 26px, the play chip 31px). One image
pixel is one CSS pixel, which a 2× display shows as a crisp 2×2 block.
Overwrite in place and rebuild — nothing else to edit.

The speaker picks its art by level in `speakerIcon()` (`now-playing.js`):
going by the drawings, `sound1` is the fullest, so loud is `sound1`. Previous
is `skip.png` with `transform: scaleX(-1)` — one drawing for both directions.

## Files

```
now-playing.js                  toolbar item + shared media tracker + the card
                                (dropdown and docked) + window.CthulhuNowPlaying
NowPlayingWidget.sys.mjs        once-per-process CustomizableUI + actor registration
CthulhuTabVolumeParent.sys.mjs  answers a frame's "what volume does my tab want"
CthulhuTabVolumeChild.sys.mjs   sets it on the page's media elements
now-playing.css                 A2-themed squircle + card + slider
assets/                         the icon slots above
```

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.now-playing.enabled`.
The CustomizableUI widget id is still `cthulhu-nowplaying`, so a profile that
already had it placed keeps its position.
