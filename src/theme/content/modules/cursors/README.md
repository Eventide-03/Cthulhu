# cursors module

Themes the mouse cursor across **both the browser chrome and web content** with
bundled pixel-art images.

## How it works
- `cursors.css` holds the rules. Unlike a normal module, it is **not** injected as
  a chrome `<link>` (that only reaches chrome). Instead `cursors.js` registers it
  as a global **USER_SHEET** via `nsIStyleSheetService`, so it applies to chrome
  *and* every content document. (That's why the manifest lists only `js`.)
- The cursor images are referenced through the **content-accessible** package
  `chrome://cthulhu-cursors/content/…` (declared `contentaccessible=yes` in
  `theme/jar.mn`). A plain `chrome://cthulhu/…` URL is blocked inside web pages;
  the content-accessible mapping is what lets the images load in content.

## Slots (one image per state)
| Slot | Image (`assets/…`) | CSS fallback | Applies to |
|------|--------------------|--------------|------------|
| **default** (a tabby cat) | `default.png` | `auto` | everything (`*`) |
| **pointer / hover** | `pointer.png` | `pointer` | `a[href]`, `button`, `[role=button]`, `summary`, `select`, … |
| **text** | `text.png` | `text` | text `input`s, `textarea`, `[contenteditable]` |
| resize | — (none yet; the system double arrow) | `ew-resize` | the width grip of the compact column (`#cthulhu-compact-resizer`, modules/compact-mode) |

Rule form: `cursor: url(<img>) <hotspot-x> <hotspot-y>, <fallback>;`

## Giving each slot its own art
1. Drop your PNG into `assets/` with the slot's name (`default.png` /
   `pointer.png` / `text.png`) — the **default** slot is the tabby cat.
2. Set the **hotspot** in `cursors.css` to your art's active point (arrow tip,
   fingertip, I-beam center). The placeholder hotspots are `1 1` / `16 4` / `16 16`.
3. Author at **native size** — CSS `image-rendering` does **not** apply to
   cursors, so a 32×32 pixel-art cursor stays crisp only at 1×; don't rely on
   scaling. Transparent background (RGBA).
4. If you add extra images, list them in `theme/jar.mn` under **both** the
   `cthulhu` package and the content-accessible `cthulhu-cursors` package.

## Auto-hide while watching video

The pointer disappears after **3 s of stillness over a playing video**, and
comes back the instant you move, click, scroll or type — or the video stops.
`CthulhuCursorIdleChild.sys.mjs` does it; `cursors.css` carries the rule it
switches on (`:root[cthulhu-cursor-idle]`).

**Why it is ours to do.** Every video site hides the pointer itself — YouTube,
Netflix and Twitch all set `cursor: none`. The sheet above is user-origin and
every rule in it is `!important`, which outranks any author rule, so the theme
was overriding all of them and the pointer sat on the picture for ever.
Firefox's own controls were no fallback: there is not one `cursor` declaration
in `videocontrols.css`. And it can't be fixed by bowing out the way
`:fullscreen` does — CSS has no way to say *"unless the page asked for none"*.
So the behaviour is reimplemented rather than merely got out of the way, which
means it now also works on a player that never implemented it.

It only fires over a video at least **300×200**, or anything in fullscreen: a
thumbnail or a loop behind a hero banner is not something you are sitting still
to watch. The pointer listeners only exist while something is playing, so an
ordinary page carries no `mousemove` handler at all.

## ⚠️ In a dev build, `cursors.css` must be a real file

The sheet is registered as a global `USER_SHEET`, so the style system loads it
inside **every content process** as well as the parent. A content process is
sandboxed to the bundle and cannot follow a symlink out of it, so with the
local build's symlinked chrome tree the sheet applies in chrome and **silently
does nothing on web pages** — the theme looks absent on the web in a dev build
while working perfectly in a release one. That hid the auto-hide bug above for
a whole release.

`tools/dev-actors.sh` copies it in as a real file alongside the child actors;
`dev-run.sh` and the tests run it. `tools/cursor-test.py` checks the theme
reached content before checking anything else, so this can't hide again.

## Toggle
`cthulhu.module.cursors.enabled` (about:config) or the `enabled` flag in
`manifest.json` — same as any module.

## ⚠️ Windows caveat (post-Phase-8 shakedown)
Cursor rendering/format is **platform-dependent** and differs on Windows:
- Windows historically **caps CSS cursor images at 32×32** and is stricter about
  format/size; larger images may be ignored (falling back to the keyword).
- Sub-pixel hotspots and some sizes render differently than on macOS/Linux.
- Animated cursors behave differently per platform.

The rules here are **platform-neutral** standard CSS (`url()` + hotspot + keyword
fallback) with no OS-specific paths — but the *visual result* must be re-checked
on Windows during the post-Phase-8 shakedown (keep art ≤ 32×32 to be safe).
