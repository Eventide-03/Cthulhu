#!/usr/bin/env node
// Generate the PLACEHOLDER pixel art the home page ships with:
//
//   - a 16x16 icon.png for every widget   (widgets/<id>/assets/icon.png)
//   - the game widget's landscape.png      (192x108)
//   - the game widget's player.png sheet   (4 frames of 16x16: idle x2, walk x2)
//
//   node tools/make-placeholder-art.mjs [--only icons|game]
//
// Everything here is meant to be REPLACED by real art: overwrite the PNG in
// place (same path, any size for the game art; 16x16 is the intended icon
// size) and rebuild. Nothing reads these files at build time, so the script
// only exists to (re)create the placeholders; it is not part of the build.
//
// Glyphs are ASCII pixel maps so the intended format is obvious at a glance:
//   .  transparent     #  light (#e8e8e8)     a  accent (#5ad1b0)     d  dark (#1a1a1a)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadSharp() {
  const require_ = createRequire(import.meta.url);
  const roots = [];
  try { roots.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch {}
  roots.push("/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules");
  for (const root of roots) {
    const p = path.join(root, "@zen-browser", "surfer", "node_modules", "sharp");
    if (existsSync(p)) return require_(p);
  }
  console.error("sharp not found: install @zen-browser/surfer globally first.");
  process.exit(1);
}
const sharp = loadSharp();
const only = (process.argv.find(a => a.startsWith("--only")) || "").split("=")[1] || "";

const WIDGETS = path.resolve("src/theme/content/newtab/widgets");
const PAL = { ".": [0, 0, 0, 0], "#": [232, 232, 232, 255], a: [90, 209, 176, 255], d: [26, 26, 26, 255],
              s: [120, 170, 230, 255], g: [86, 160, 90, 255], G: [60, 120, 66, 255], t: [110, 76, 46, 255],
              y: [250, 220, 120, 255], k: [40, 46, 60, 255], p: [232, 180, 150, 255], b: [70, 90, 160, 255] };

function fromMap(rows) {
  const h = rows.length, w = rows[0].length;
  const buf = Buffer.alloc(w * h * 4);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error("ragged row " + y);
    [...row].forEach((ch, x) => {
      const c = PAL[ch]; if (!c) throw new Error("unknown char " + ch);
      buf.set(c, (y * w + x) * 4);
    });
  });
  return { buf, w, h };
}
async function writePng(file, { buf, w, h }) {
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
  console.log("  " + path.relative(process.cwd(), file) + "  " + w + "x" + h);
}

/* ------------------------------ 16x16 icons ------------------------------ */
const ICONS = {
  clock: [
    "................",
    ".....######.....",
    "...##......##...",
    "..#..........#..",
    ".#.....#......#.",
    ".#.....#......#.",
    "#......#.......#",
    "#......#.......#",
    "#......####....#",
    "#..............#",
    ".#............#.",
    ".#............#.",
    "..#..........#..",
    "...##......##...",
    ".....######.....",
    "................",
  ],
  calendar: [
    "................",
    "..#..........#..",
    ".##############.",
    ".#aaaaaaaaaaaa#.",
    ".#aaaaaaaaaaaa#.",
    ".##############.",
    ".#............#.",
    ".#.##..##..##.#.",
    ".#.##..##..##.#.",
    ".#............#.",
    ".#.##..##..##.#.",
    ".#.##..##..##.#.",
    ".#............#.",
    ".##############.",
    "................",
    "................",
  ],
  "quick-links": [
    "................",
    "..###########...",
    "..#.........#...",
    "..#.........#...",
    "..#....######...",
    "..#....#...a#...",
    "..#....#..aa#...",
    "..#....#.aaa#...",
    "..#....#aaaa#...",
    "..#....######...",
    "..#.........#...",
    "..#.........#...",
    "..###########...",
    "................",
    "................",
    "................",
  ],
  folder: [
    "................",
    "................",
    ".#######........",
    ".#aaaaa##.......",
    ".#aaaaaa#######.",
    ".##############.",
    ".#............#.",
    ".#............#.",
    ".#............#.",
    ".#............#.",
    ".#............#.",
    ".#............#.",
    ".##############.",
    "................",
    "................",
    "................",
  ],
  notes: [
    "................",
    "..##########....",
    "..#........##...",
    "..#........#.#..",
    "..#........####.",
    "..#..aaaaa....#.",
    "..#...........#.",
    "..#..aaaaaaa..#.",
    "..#...........#.",
    "..#..aaaaa....#.",
    "..#...........#.",
    "..#..aaaaaaa..#.",
    "..#...........#.",
    "..#############.",
    "................",
    "................",
  ],
  search: [
    "................",
    "....#####.......",
    "...#.....#......",
    "..#.......#.....",
    ".#.........#....",
    ".#.........#....",
    ".#.........#....",
    ".#.........#....",
    "..#.......#.....",
    "...#.....#aa....",
    "....#####.aaa...",
    "...........aaa..",
    "............aaa.",
    ".............aa.",
    "................",
    "................",
  ],
  "feature-request": [
    "................",
    ".############...",
    "#............#..",
    "#.....aa.....#..",
    "#.....aa.....#..",
    "#..aaaaaaaa..#..",
    "#..aaaaaaaa..#..",
    "#.....aa.....#..",
    "#.....aa.....#..",
    "#............#..",
    ".############...",
    "....##..........",
    "...##...........",
    "..##............",
    "................",
    "................",
  ],
  moon: [
    "................",
    ".....######.....",
    "...###....##....",
    "..##........#...",
    ".##.........#...",
    ".#..........##..",
    "#............#..",
    "#............#..",
    "#............#..",
    "#...........##..",
    ".#..........#...",
    ".##........##...",
    "..##......##....",
    "...###..###.....",
    ".....####.......",
    "................",
  ],
  orb: [
    "................",
    "......aaaa......",
    "....aa#aaaaa....",
    "...a###aaaaaa...",
    "..a####aaaaaaa..",
    "..a###aaaaaaaa..",
    ".aa##aaaaaaaaaa.",
    ".aaaaaaaaaaaaaa.",
    ".aaaaaaaaaaaaaa.",
    ".aaaaaaaaaaaaaa.",
    "..aaaaaaaaaaaa..",
    "..aaaaaaaaaaaa..",
    "...aaaaaaaaaa...",
    "....aaaaaaaa....",
    "......aaaa......",
    "................",
  ],
  pet: [
    "................",
    "..#.........#...",
    "..##.......##...",
    "..###.....###...",
    "..###########...",
    ".#############..",
    ".#############..",
    ".##a#######a##..",
    ".##a#######a##..",
    ".#############..",
    ".######d######..",
    ".#####d.d#####..",
    "..###########...",
    "...#########....",
    "................",
    "................",
  ],
  gradient: [
    "................",
    ".############...",
    ".#aaaaaaaaaa#...",
    ".#aaaaaaaaa.#...",
    ".#aaaaaaaa..#...",
    ".#aaaaaaa...#...",
    ".#aaaaaa....#...",
    ".#aaaaa.....#...",
    ".#aaaa......#...",
    ".#aaa.......#...",
    ".#aa........#...",
    ".#a.........#...",
    ".############...",
    "................",
    "................",
    "................",
  ],
  theme: [
    "................",
    ".#######.#######",
    ".#aaaaa#.#.....#",
    ".#aaaaa#.#.....#",
    ".#aaaaa#.#.....#",
    ".#######.#######",
    "................",
    ".#######.#######",
    ".#.....#.#ddddd#",
    ".#.....#.#ddddd#",
    ".#.....#.#ddddd#",
    ".#######.#######",
    "................",
    "................",
    "................",
    "................",
  ],
  game: [
    "................",
    "................",
    "...##########...",
    "..############..",
    ".###.###.#..###.",
    ".##...##.#a#.##.",
    ".#####.####.a##.",
    ".##...##.#a#.##.",
    ".###.###.#..###.",
    "..############..",
    "..###......###..",
    "..##........##..",
    "................",
    "................",
    "................",
    "................",
  ],
  palette: [
    "................",
    "....########....",
    "..##........##..",
    ".#..aa....##..#.",
    ".#..aa....##..#.",
    "#..............#",
    "#.##......##...#",
    "#.##......##...#",
    "#..............#",
    "#.....aa.......#",
    ".#....aa....###.",
    ".#.........#....",
    "..##......#.....",
    "....######......",
    "................",
    "................",
  ],
  refboard: [
    "................",
    ".......a........",
    "......aaa.......",
    ".##############.",
    ".#............#.",
    ".#..###.......#.",
    ".#.#####......#.",
    ".#.#####...#..#.",
    ".#..###...###.#.",
    ".#.......#####.#",
    ".#............#.",
    ".##############.",
    "................",
    "................",
    "................",
    "................",
  ],
  deadlines: [
    "................",
    "..###########...",
    "...#.......#....",
    "...#.......#....",
    "...#.aaaaa.#....",
    "....#.aaa.#.....",
    ".....#.a.#......",
    "......#.#.......",
    "......#.#.......",
    ".....#...#......",
    "....#..a..#.....",
    "...#..aaa..#....",
    "...#.aaaaa.#....",
    "...#aaaaaaa#....",
    "..###########...",
    "................",
  ],
};

/* ----------------------------- game placeholders -------------------------- */
function landscape(w = 192, h = 108) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      let c = y < 30 ? "s" : y < 55 ? "s" : "g";
      if (y < 30 && ((x + y) % 23 === 0) && y > 4 && x % 7 === 3) c = "#"; // faint stars/clouds
      // sun
      const dx = x - 160, dy = y - 20;
      if (dx * dx + dy * dy < 64) c = "y";
      // distant hills
      const hill = 52 - Math.round(10 * Math.sin(x / 18) + 6 * Math.sin(x / 7 + 1));
      if (y >= hill && y < 60) c = "G";
      // ground band + horizon line
      if (y >= 60) c = "g";
      if (y === 60) c = "G";
      // a winding path
      const px = 96 + Math.round(22 * Math.sin(y / 9));
      if (y > 62 && Math.abs(x - px) < 7) c = "t";
      // checker texture on grass
      if (c === "g" && ((x >> 2) + (y >> 2)) % 2 === 0) c = "G";
      row += c;
    }
    rows.push(row);
  }
  // two trees (trunk + canopy)
  const tree = (cx, base) => {
    for (let y = base - 3; y < base; y++) for (let x = cx - 1; x <= cx; x++) rows[y] = rows[y].slice(0, x) + "t" + rows[y].slice(x + 1);
    for (let y = base - 12; y < base - 3; y++) {
      const r = 6 - Math.abs((base - 8) - y);
      for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && x < w) rows[y] = rows[y].slice(0, x) + (y % 3 === 0 ? "G" : "g") + rows[y].slice(x + 1);
    }
  };
  tree(30, 85); tree(165, 95);
  return fromMap(rows);
}
function playerSheet() {
  const idle0 = [
    "................",
    "......####......",
    ".....#pppp#.....",
    ".....#p##p#.....",
    ".....#pppp#.....",
    "......####......",
    ".....aaaaaa.....",
    "....a#aaaa#a....",
    "....a.aaaa.a....",
    "......aaaa......",
    "......bbbb......",
    "......b..b......",
    "......b..b......",
    ".....dd..dd.....",
    "................",
    "................",
  ];
  const idle1 = idle0.map((r, i) => (i === 0 ? "................" : idle0[i - 1])); // bob down 1px
  const walk0 = idle0.map((r, i) => (i === 11 ? "......b.b......." : i === 12 ? ".....b...b......" : i === 13 ? "....dd...dd....." : r));
  const walk1 = idle0.map((r, i) => (i === 11 ? ".......b.b......" : i === 12 ? "......b...b....." : i === 13 ? ".....dd...dd...." : r));
  const frames = [idle0, idle1, walk0, walk1];
  const w = 16, h = 16;
  const buf = Buffer.alloc(w * frames.length * h * 4);
  frames.forEach((rows, f) => {
    const { buf: fb } = fromMap(rows);
    for (let y = 0; y < h; y++) fb.copy(buf, (y * w * frames.length + f * w) * 4, y * w * 4, (y + 1) * w * 4);
  });
  return { buf, w: w * frames.length, h };
}

(async () => {
  if (!only || only === "icons") {
    console.log("icons:");
    for (const [id, rows] of Object.entries(ICONS)) {
      await writePng(path.join(WIDGETS, id, "assets", "icon.png"), fromMap(rows));
    }
  }
  if (!only || only === "game") {
    console.log("game:");
    await writePng(path.join(WIDGETS, "game", "assets", "landscape.png"), landscape());
    await writePng(path.join(WIDGETS, "game", "assets", "player.png"), playerSheet());
  }
})();
