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
//
// EXCEPT firefox.icns, which we build ourselves and override. Surfer generates
// it via async-icns, whose resizeImage() is literally `sips -Z <size>` -- the
// smooth resample this whole script exists to avoid. Measured on the generated
// file: the 512 entry kept the master's 16 colours, but 16/32/64/128/256 came
// out at 210-1098 colours, i.e. blurred, and 128/256 are the sizes macOS
// actually shows in the Dock. So we write a nearest-neighbour firefox.icns to
// src/browser/branding/<brand>/ instead. surfer's applyPatches() runs the
// branding patch BEFORE the src/ copy-patch stage, so ours lands last and wins;
// browser/app/Makefile.in copies it with `cp -RL`, which follows the symlink
// that the copy-patch stage creates.
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

// ---------------------------------------------------------------------------
// macOS app icon. Built here rather than left to surfer -- see the header.
//
// An .iconset maps each name to one pixel size; @2x entries are just the
// larger pixel size under a second name, so several names share one image.
// Every size below is an integer multiple of whichever master suits it: the
// 16 master covers 16 and 32 (where the detailed drawing would turn to mud),
// the 64 master covers 64 and up.
//
// The container is written by hand rather than with `iconutil`, for the same
// reason the ICO is: iconutil corrupts the art. Feeding it a correct .iconset
// still produced an .icns whose 16x16 entry had four opaque bottom-right
// pixels change from rgb(25,25,64) to rgb(25,25,0) -- the blue channel's last
// RLE run dropped, in the legacy `is32` type it writes for small icons. There
// are no partial-alpha pixels in the master, so nothing else explains it.
// Writing PNG-typed entries ourselves stores each image byte-for-byte, and as
// a bonus drops the macOS-only iconutil dependency so this runs anywhere.
//
// Layout: "icns" + big-endian uint32 total length, then one record per entry
// of 4-byte OSType + big-endian uint32 length (records COUNT their own 8-byte
// header). Types are the PNG-capable ones (10.7+); several sizes appear twice
// because macOS looks up the @2x variants under their own type.
// The 16 and 32 entries additionally need the LEGACY types. icp4/icp5 nominally
// hold a PNG, but iconutil ignores ours and re-derives those two sizes by
// smoothly downscaling a bigger entry -- so macOS's icon services, which share
// that reader, would blur exactly the sizes used in Finder lists and the window
// proxy icon. Supplying is32/il32 (24-bit RGB, RLE) plus their s8mk/l8mk alpha
// masks pins them exactly.
const ICNS_PNG = [
  ["icp4", 16, () => src16],   // 16x16
  ["icp5", 32, () => src16],   // 32x32
  ["ic11", 32, () => src16],   // 16x16@2x
  ["ic12", 64, () => src64],   // 32x32@2x
  ["ic07", 128, () => src64],  // 128x128
  ["ic13", 256, () => src64],  // 128x128@2x
  ["ic08", 256, () => src64],  // 256x256
  ["ic14", 512, () => src64],  // 256x256@2x
  ["ic09", 512, () => src64],  // 512x512
  ["ic10", 1024, () => src64], // 512x512@2x
];
const ICNS_LEGACY = [
  ["is32", "s8mk", 16, () => src16],
  ["il32", "l8mk", 32, () => src16],
];

/** Apple's PackBits variant, as used by is32/il32 colour planes.
 *  control < 0x80: (control + 1) literal bytes follow.
 *  control >= 0x80: repeat the next byte (control - 0x80 + 3) times.
 *
 *  The last byte of every plane is force-emitted as a one-byte literal so the
 *  stream never ENDS on a repeat run. Apple's own reader drops a trailing
 *  repeat run: feeding iconutil a correct .iconset produced an .icns whose
 *  16x16 blue plane lost its final run of four, turning the bottom-right
 *  rgb(25,25,64) pixels into rgb(25,25,0). Our encoder round-trips exactly
 *  through a spec-conformant decoder, so this only sidesteps that reader bug. */
function packBits(plane) {
  const out = [];
  const tail = plane[plane.length - 1];
  plane = plane.subarray(0, plane.length - 1);
  let i = 0;
  while (i < plane.length) {
    let run = 1;
    while (i + run < plane.length && plane[i + run] === plane[i] && run < 130) {
      run++;
    }
    if (run >= 3) {
      out.push(0x80 + run - 3, plane[i]);
      i += run;
      continue;
    }
    // Gather literals until a run of 3+ starts, or we hit the 128-byte cap.
    const start = i;
    while (i < plane.length && i - start < 128) {
      if (
        i + 2 < plane.length &&
        plane[i] === plane[i + 1] &&
        plane[i] === plane[i + 2]
      ) {
        break;
      }
      i++;
    }
    out.push(i - start - 1, ...plane.subarray(start, i));
  }
  out.push(0, tail);
  if (pad) {
    out.push(0, 0);
  }
  return Buffer.from(out);
}

const record = (type, data) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, "ascii");
  head.writeUInt32BE(data.length + 8, 4);
  return [head, data];
};

const records = [];
for (const [type, size, master] of ICNS_PNG) {
  records.push(...record(type, await scale(master(), size)));
}
for (const [rgbType, maskType, size, master] of ICNS_LEGACY) {
  const { data } = await sharp(master())
    .resize(size, size, { kernel: sharp.kernel.nearest, fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = size * size;
  // Colour data is stored as three separate planes, each RLE'd on its own.
  const planes = [0, 1, 2].map(c => {
    const plane = Buffer.alloc(px);
    for (let i = 0; i < px; i++) {
      plane[i] = data[i * 4 + c];
    }
    return packBits(plane, c === 2);
  });
  records.push(...record(rgbType, Buffer.concat(planes)));
  // The mask is a plain uncompressed 8-bit alpha channel.
  const mask = Buffer.alloc(px);
  for (let i = 0; i < px; i++) {
    mask[i] = data[i * 4 + 3];
  }
  records.push(...record(maskType, mask));
}
const body = Buffer.concat(records);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(body.length + 8, 4);

const icnsDir = path.resolve("src", "browser", "branding", brand);
mkdirSync(icnsDir, { recursive: true });
const icnsPath = path.join(icnsDir, "firefox.icns");
writeFileSync(icnsPath, Buffer.concat([icnsHeader, body]));
written.push([
  path.relative(process.cwd(), icnsPath),
  [...new Set(ICNS_PNG.map(e => e[1]))].join("/"),
  "16px + 64px masters",
]);

console.log(`Wrote ${written.length} files to ${path.relative(process.cwd(), outDir)}:`);
for (const [name, size, from] of written) {
  console.log(`  ${name.padEnd(16)} ${String(size).padStart(11)}  from ${from}`);
}
console.log(
  "\nNote: 22 and 24 are not integer multiples of the 16px master, so those two\n" +
    "are the only slightly uneven ones. They are Linux-only sizes that Surfer\n" +
    "requires to exist; macOS and Windows never display them."
);
