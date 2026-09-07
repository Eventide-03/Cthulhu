/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Cthulhu home / new-tab page bootstrap: initialize the GridStack dashboard,
 * then hand off to the widget system (palette, drag-in, persistence, restore).
 * See widgets.js and widgets/README.md. */
"use strict";

// Apply the browser-wide theme (pref cthulhu.theme) to this page before the
// grid draws, and keep following it. Same engine the chrome uses, so the page
// and the toolbar are always the same palette.
if (window.CthulhuThemes) {
  try { CthulhuThemes.watch(document); } catch (e) { console.error("[Cthulhu:newtab] theme:", e); }
}

// Switching between #home and new-tab is only a hash change (no reload), which
// wouldn't re-pick the mode / layout — so force a fresh load when the hash flips.
window.addEventListener("hashchange", () => location.reload());

(function initGrid() {
  // Tab title: new tabs say "New Tab"; the home page (#home) says "Home".
  const mode = location.hash === "#home" ? "home" : "newtab";
  document.title = mode === "home" ? "Home" : "New Tab";

  if (typeof GridStack === "undefined") {
    console.error("[Cthulhu:newtab] GridStack failed to load");
    return;
  }
  const TARGET_CELL = 156; // px; ~screenshot density (square cells). Lower = denser.
  const el = document.getElementById("grid");
  const colsFor = (w) => Math.max(3, Math.round((w || window.innerWidth) / TARGET_CELL));
  const rowsFor = (cell) => Math.max(1, Math.floor(window.innerHeight / cell));

  const initCell = (el.clientWidth || window.innerWidth) / colsFor(el.clientWidth);
  const grid = GridStack.init(
    {
      column: colsFor(el.clientWidth),
      cellHeight: TARGET_CELL,
      maxRow: rowsFor(initCell), // keep the grid within the viewport — no scroll
      margin: 8,
      float: true,
      animate: true,
      // "a" is deliberately NOT cancelled so a link tile (quick-link) can be
      // dragged to move the widget; a click still navigates (GridStack tells a
      // click from a drag by movement).
      // canvas: the minigame's world takes clicks and key focus itself.
      // [data-cthulhu-nodrag]: any element a widget marks this way -- the
      // calendar's event boxes, which have their own drag -- never starts a
      // tile drag. GridStack checks it with closest(), so children count.
      draggable: { cancel: "input,textarea,select,button,[contenteditable],canvas,[data-cthulhu-nodrag]" },
    },
    el
  );

  // Round a CSS-pixel length to a whole number of DEVICE pixels.
  //
  // The grid lines are two repeating linear-gradients with a 1px hard stop,
  // tiled at background-size: <cellW> <cellH>. Divisions like
  // innerHeight / rows are almost never a whole number of device pixels, so
  // each successive tile starts a fraction of a pixel further off than the
  // last; when that drift crosses a pixel boundary the 1px line inside the
  // tile rounds away to nothing and the line simply is not drawn. The result
  // is a grid that looks like every other horizontal line is missing -- which
  // is exactly what a 1.25x or 1.5x Windows display shows, while the Mac's
  // 2x scaling happens to divide cleanly and hides the bug.
  //
  // Snapping the tile to whole device pixels puts every tile boundary -- and
  // so every line -- on an exact pixel, at any scale factor. GridStack gets
  // the same snapped value, so widgets stay aligned to the lines they sit on.
  // The cost is up to one device pixel of unused space per row.
  const snapToDevicePx = (v) => {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(1, Math.round(v * dpr)) / dpr;
  };

  function layout() {
    const width = el.clientWidth || window.innerWidth;
    const cols = colsFor(width);
    if (grid.getColumn() !== cols) grid.column(cols, "none");
    const cellW = snapToDevicePx(width / cols); // drives gridline spacing horizontally
    // Rows FILL the viewport height, so there's no dead partial row at the
    // bottom — every visible row is usable. Cells end up ~square.
    const rows = Math.max(1, Math.round(window.innerHeight / cellW));
    const cellH = snapToDevicePx(window.innerHeight / rows);
    grid.cellHeight(cellH);
    grid.opts.maxRow = rows;
    if (grid.engine) grid.engine.maxRow = rows;
    el.style.setProperty("--cthulhu-cell", cellW + "px");
    el.style.setProperty("--cthulhu-cell-h", cellH + "px");
  }
  layout();
  window.addEventListener("resize", layout);
  // Dragging the window to a monitor with a different scale factor changes
  // devicePixelRatio, which changes what "a whole device pixel" means. That
  // does not always come with a resize event, so watch the ratio itself.
  (function watchDpr() {
    let mql;
    const rewatch = () => {
      if (mql) mql.removeEventListener("change", onChange);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener("change", onChange);
    };
    function onChange() { layout(); rewatch(); }
    rewatch();
  })();

  window.__cthulhuGrid = grid;
  window.__cthulhuRelayout = layout; // called when the drawer opens/closes

  if (window.CthulhuHome) {
    window.CthulhuHome.init(grid);
  } else {
    console.error("[Cthulhu:newtab] CthulhuHome not loaded");
  }
})();
