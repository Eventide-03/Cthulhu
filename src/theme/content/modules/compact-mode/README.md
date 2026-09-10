# Compact mode (vertical tabs)

Zen Browser's compact mode: with vertical tabs on and compact mode on, **the
page gets the whole window**. Everything that is chrome lives in one column at
the window's edge, laid out as Zen lays it out — the window buttons, back /
forward / reload / all-tabs and the menu on the first row, the address bar on
the second, the tabs under them, and the player as a bar at the bottom — and
that column stays off-screen until the pointer touches the edge, the address
bar takes focus (Cmd/Ctrl+L), or a menu is opened from inside it. Move away
and it slides out again after a moment, address bar included.

| Turn it on/off | |
| --- | --- |
| Keyboard | **Ctrl/Cmd + Alt + C** (Zen's shortcut) |
| Menu | right-click the strip or the toolbar → **Compact mode** (only shown while vertical tabs are on) |
| Pref | `cthulhu.compact.mode` |

**Width:** drag the column's inner edge (a 6px grab strip that lights up under
the pointer). The toolbox, the tabs and the player are all sized by the one
variable, so they follow together; the width is kept in `cthulhu.compact.width`
(200–520px, 260 by default).

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
its card at the bottom of the column (`window.CthulhuNowPlaying.dock()`) —
Zen's bar: the four controls, and the title / progress only while the pointer
is on it — and the toolbar squircle is hidden while it is there. The sidebar
toggle button is hidden in the column: it would hide the strip the column is
made of, and its row goes to the all-tabs button instead.

**The address bar needs one more rule.** Upstream's `<moz-urlbar>` is a
`popover="manual"` shown whenever the bar is in "breakout" mode — which is
always, in a normal window — and a popover lives in the top layer, where an
ancestor's `translate` does not reach it. So hiding the toolbox left the
address bar sitting over the page at the column's open position. It is still
the toolbox's descendant in the tree, so `compact-mode.css` slides it by the
column's width (`transform`, since upstream animates the popover with
`translate`) whenever the column is hidden, in step with it.

## The launcher after vertical tabs

Not compact mode, but the same strip. Upstream sets `sidebar.visibility` to
`always-show` when vertical tabs go on and to `hide-sidebar` when they go off
(`SidebarManager.handleVerticalTabsPrefChange`), and its `hide-sidebar` rule
for horizontal tabs is "launcher visible initially" — so a window that had the
tool strip hidden got it back, open at the edge, every time vertical tabs were
tried and turned off, to be closed by hand. `compact-mode.js` remembers whether
the launcher was showing while the tabs were horizontal
(`cthulhu.sidebar.launcherShownHorizontal`, read off the container's `hidden`
attribute whenever it changes) and, once the tabs are horizontal again and
upstream has done its showing, puts it back the way it was.

`compact-mode.js` adds the 6px hot zone at the edge, the grab strip for the
width, the open/close timing, the key, the menu items and the pref observers.
The root carries `[cthulhu-vertical-tabs]` and, when active,
`[cthulhu-compact]`.

## When it stays out, and why it no longer does

The column stays out while something wants it: the pointer is over it, a menu
opened from inside it is up, the address bar (or anything you type into) has
focus, focus arrived there by keyboard, or its edge is being dragged. Three
things used to hold it out by mistake:

- **A tooltip.** Tooltips are popups; one over a tab counted as a menu opened
  from inside, and by the time `popuphidden` fired the popup's `triggerNode`
  was already null, so the count went up and never came down — the column
  stayed out until the next restart. Popups are now tracked by node, and
  tooltips hold nothing.
- **A click on the current tab** left focus on the tab, and any focus inside
  counted. Now only text fields and keyboard focus (`:focus-visible`) count.
- **A `mouseleave` that never came** (the pointer left across a native widget).
  While the column is out, a 1.5 s watchdog re-checks the conditions above and
  closes it when none holds.

Follows the standard feature-module convention (see `../README.md`):
discovered via `../index.json`, gated by `cthulhu.module.compact-mode.enabled`.
