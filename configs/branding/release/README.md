# Branding: `release` channel

Surfer reads this directory when the active brand key is `release` and generates
`engine/browser/branding/release/` from it (icons, `brand.ftl`, `brand.properties`,
`brand.dtd`, `configure.sh`).

**The directory name is the channel identifier, not the display name.** The
user-visible name comes from `brands.release.brandShortName` in `surfer.json`
(currently "Cthulhu"). See PRIVACY.md / the repo README for why they differ.

## ART SLOTS — replace these placeholders

Every file below is **generated, not hand-edited**. They come from two pixel-art
masters via:

```
node tools/make-branding-icons.mjs <16px master> <64px master> [brand]
```

Edit the masters and re-run that; do not touch these files directly. Every one is
required — Surfer's `checkForFaults()` throws if any of the four "required" names
are missing, and `setupImages()` throws if any `logo<size>.png` is missing.

**Two masters, because one does not scale.** A 64×64 design shrunk to 16×16 turns
to mud, so the small icons need their own simplified drawing. Everything else is
an INTEGER nearest-neighbour multiple of one master, which is what keeps pixel art
crisp — any smooth resample (what `sips` does by default) blurs the edges. 16, 32
and 48 come from the 16px master (1×, 2×, 3×); 64 through 512 from the 64px master
(1×, 2×, 4×, 8×). Only 22 and 24 are not integer multiples of either; they are
Linux tray sizes we never display, kept because Surfer requires them to exist.

| File | Size | Used for |
| --- | --- | --- |
| `logo16.png` … `logo512.png` | 16, 22, 24, 32, 48, 64, 128, 256, 512 | `default<size>.png` in the branding dir; Linux icons, about: artwork |
| `logo.png` | 512×512 | source for `content/about-logo.png` (512) and `about-logo@2x.png` (1024) |
| `logo-mac.png` | 512×512 | converted to `firefox.icns` — the macOS app icon |
| `firefox.ico` | 16/32/48/256 | Windows app icon |
| `firefox64.ico` | 64 | Windows app icon (64px) |

`logo.png` and `logo-mac.png` are both the 64px master at 512. macOS icons
conventionally sit in about 80% of their canvas with transparent padding, so if
the dock icon looks oversized next to other apps, give `logo-mac.png` its own
padded master rather than changing the shared art.

Regenerate the build's branding after replacing art:

```
surfer import && surfer build
```
