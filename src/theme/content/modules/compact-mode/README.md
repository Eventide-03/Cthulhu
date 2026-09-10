# Compact mode (vertical tabs)

Zen Browser's compact mode: with vertical tabs on and compact mode on, **the
page gets the whole window**. Everything that is chrome lives in one column at
the window's edge — the navigation toolbar (back / forward / reload, the
address bar on its own row, the menu), the tabs, and the player docked at the
bottom — and that column stays off-screen until the pointer touches the edge,
the address bar takes focus (Cmd/Ctrl+L), or a menu is opened from inside it.
Move away and it slides out again after a moment.

| Turn it on/off | |
| --- | --- |
| Keyboard | **Ctrl/Cmd + Alt + C** (Zen's shortcut) |
| Menu | right-click the strip or the toolbar → **Compact mode** (only shown while vertical tabs are on) |
| Pref | `cthulhu.compact.mode` |

Turning it on also sets `sidebar.visibility` to `always-show`: upstream's own
"expand on hover" and "hide sidebar" modes move the same element with inline
styles, and the two would fight. Entering customize mode suspends it (the
toolbox has to be in the flow to be customised); it resumes when you leave.

With horizontal tabs the pref is inert — the tabs live in the toolbox.

## How it works, and why nothing is moved

Nothing changes in the DOM, which is what keeps Firefox working. The toolbox
(`#navigator-toolbox`) is a sibling above the browser area; `compact-mode.css`
takes it out of the flow with `position: absolute` at the top-left, gives it
the column's width (260px) and lets its buttons wrap so the address bar gets a
row of its own. `#sidebar-container` (Firefox's own box around
`<sidebar-main>`, the vertical tabs) is positioned the same way and padded at
the top by the toolbox's measured height, so the tabs start under it. Both hide
and show together with `translate` (`!important`, because upstream sets
`translate: 0` on the container for its own animations and animates it with
the Web Animations API, which an important declaration outranks).
CustomizableUI, the address bar's breakout popover and customize mode all keep
working because every element is still where they expect it in the tree.

The only thing added is the player: `now-playing.js` mounts a docked copy of
its card at the bottom of the column (`window.CthulhuNowPlaying.dock()`), and
the toolbar squircle is hidden while it is there.

`compact-mode.js` adds the 6px hot zone at the edge, the open/close timing
(hover, focus inside, menus opened from inside), the key, the menu items and
the pref observers. The root carries `[cthulhu-vertical-tabs]` and, when
active, `[cthulhu-compact]`.

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.compact-mode.enabled`.
