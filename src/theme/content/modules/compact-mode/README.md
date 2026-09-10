# Compact mode (vertical tabs)

Zen Browser's compact mode, for the vertical tab strip: with vertical tabs on
and compact mode on, the strip leaves the layout so the page gets the whole
window, and slides back in **over** the page while the pointer is at the
window's edge or on the strip. Move away and it slides out again after a
moment. A right-click menu opened from inside it keeps it open until the menu
closes.

| Turn it on/off | |
| --- | --- |
| Keyboard | **Ctrl/Cmd + Alt + C** (Zen's shortcut) |
| Menu | right-click the strip or the toolbar → **Compact mode** (only shown while vertical tabs are on) |
| Pref | `cthulhu.compact.mode` |

Turning it on also sets `sidebar.visibility` to `always-show`: upstream's own
"expand on hover" and "hide sidebar" modes move the same element with inline
styles, and the two would fight.

With horizontal tabs the pref is inert — there is no strip to hide.

## How it works

Nothing is re-implemented. `#sidebar-container` is Firefox's own box around
`<sidebar-main>` (the vertical tabs live inside it); it stays resizable and
still expands/collapses with its own button. `compact-mode.css` takes it out
of flow with `position: absolute` and hides/shows it with `translate` —
`!important`, because upstream sets `translate: 0` on that element for its own
animations and animates it with the Web Animations API, which an important
declaration outranks. `compact-mode.js` adds the 6px hot zone at the edge, the
open/close timing, the key, the menu items, and the pref observers. The root
carries `[cthulhu-vertical-tabs]` and, when active, `[cthulhu-compact]`.

Only the sidebar hides. Zen can also hide the toolbar; that is not done here.

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.compact-mode.enabled`.
