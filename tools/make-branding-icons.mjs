#!/usr/bin/env node
// Regenerate every branding icon in configs/branding/<brand>/ from two pixel-art
// masters. Run it whenever the logo art changes:
//
//   node tools/make-branding-icons.mjs <16px master> <64px master> [brand]
//
// WHY TWO MASTERS: a 64x64 design shrunk to 16x16 turns to mud, so small icons
// need their own simplified drawing. Everything else is an INTEGER
// nearest-neighbour multiple of one of them, which is what keeps pixel art
// crisp -- any smooth/bilinear resample (what `sips` does by default) blurs the
// edges and defeats the whole style.
//
//   16 master -> 16 (1x), 32 (2x), 48 (3x)
//   64 master -> 64 (1x), 128 (2x), 256 (4x), 512 (8x), logo.png, logo-mac.png
//
// The two exceptions are 22 and 24: they are not integer multiples of either
// master. They are GTK/Linux tray sizes, we ship macOS and Windows only, and
// Surfer refuses to build if they are absent -- so they are scaled from the 16
// master and their slight unevenness is accepted rather than papered over.
//
// Surfer turns these into the real artefacts at `surfer import` time:
// logo-mac.png -> firefox.icns (macOS app icon), logo.png -> about-logo.png and
// about-logo@2x.png, and each logo<size>.png -> default<size>.png. The two .ico
// files are written here because sharp cannot encode ICO.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// sharp lives in the globally-installed surfer, which this repo already
// requires. Resolving it from there avoids adding a node_modules to the repo.
function loadSharp() {
  const require_ = createRequire(import.meta.url);
  const roots = [];
  try {
    roots.push(execSync("npm root -g", { encoding: "utf8" }).trim());
  } catch {}
  roots.push("/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules");
  for (const root of roots) {
    const p = path.join(root, "@zen-browser", "surfer", "node_modules", "sharp");
    if (existsSync(p)) {
      return require_(p);
    }
  }
  console.error(
    "Could not find sharp. It ships inside the global @zen-browser/surfer\n" +
      "install, so `npm install -g @zen-browser/surfer` first."
  );
  process.exit(1);
}

const sharp = loadSharp();

const [src16, src64, brand = "release"] = process.argv.slice(2);
if (!src16 || !src64) {
  console.error(
    "usage: node tools/make-branding-icons.mjs <16px master> <64px master> [brand]"
  );
  process.exit(1);
}

const outDir = path.resolve("configs", "branding", brand);
mkdirSync(outDir, { recursive: true });

// nearest-neighbour, no smoothing, no alpha premultiplication surprises
const scale = (src, size) =>
  sharp(src)
    .resize(size, size, { kernel: sharp.kernel.nearest, fit: "fill" })
    .png()
    .toBuffer();

/** Minimal ICO writer: header + one directory entry per image + PNG payloads.
 *  PNG-in-ICO is valid for Vista+ and is what modern toolchains emit. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, data }, i) => {
    const at = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // palette size (0 = none)
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, dir, ...entries.map(e => e.data)]);
}

const FROM_16 = [16, 22, 24, 32, 48];
const FROM_64 = [64, 128, 256, 512];

const written = [];
for (const size of FROM_16) {
  writeFileSync(path.join(outDir, `logo${size}.png`), await scale(src16, size));
  written.push([`logo${size}.png`, size, "16px master"]);
}
for (const size of FROM_64) {
  writeFileSync(path.join(outDir, `logo${size}.png`), await scale(src64, size));
  written.push([`logo${size}.png`, size, "64px master"]);
}

// logo.png feeds about:'s artwork; logo-mac.png becomes firefox.icns. Both are
// 512 and both come from the detailed master.
const big = await scale(src64, 512);
writeFileSync(path.join(outDir, "logo.png"), big);
writeFileSync(path.join(outDir, "logo-mac.png"), big);
written.push(["logo.png", 512, "64px master"], ["logo-mac.png", 512, "64px master"]);

// Windows icons. firefox.ico carries the small sizes Explorer picks between;
// firefox64.ico is the single 64px variant Firefox's installer wants.
const icoSizes = [16, 32, 48, 256];
const icoEntries = [];
for (const size of icoSizes) {
  icoEntries.push({
    size,
    data: await scale(size <= 48 ? src16 : src64, size),
  });
}
writeFileSync(path.join(outDir, "firefox.ico"), buildIco(icoEntries));
writeFileSync(
  path.join(outDir, "firefox64.ico"),
  buildIco([{ size: 64, data: await scale(src64, 64) }])
);
written.push(
  ["firefox.ico", icoSizes.join("/"), "16px + 64px masters"],
  ["firefox64.ico", 64, "64px master"]
);

console.log(`Wrote ${written.length} files to ${path.relative(process.cwd(), outDir)}:`);
for (const [name, size, from] of written) {
  console.log(`  ${name.padEnd(16)} ${String(size).padStart(11)}  from ${from}`);
}
console.log(
  "\nNote: 22 and 24 are not integer multiples of the 16px master, so those two\n" +
    "are the only slightly uneven ones. They are Linux-only sizes that Surfer\n" +
    "requires to exist; macOS and Windows never display them."
);
