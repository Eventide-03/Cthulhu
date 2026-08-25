# Branding: `nightly` channel

Surfer reads this directory when the active brand key is `nightly` and generates
`engine/browser/branding/nightly/` from it (icons, `brand.ftl`, `brand.properties`,
`brand.dtd`, `configure.sh`).

**The directory name is the channel identifier, not the display name.** The
user-visible name comes from `brands.nightly.brandShortName` in `surfer.json`
(currently "Cthulhu"). See PRIVACY.md / the repo README for why they differ.

## ART SLOTS — replace these placeholders

All files below are **placeholders** (a teal disc on a dark field with a diagonal
notch, so it is obvious they are stand-ins). Replace them with real pixel art at
the same filenames and pixel dimensions. Every file is required — Surfer's
`checkForFaults()` throws if any of the four "required" names are missing, and
`setupImages()` throws if any `logo<size>.png` is missing.

| File | Size | Used for |
| --- | --- | --- |
| `logo16.png` … `logo512.png` | 16, 22, 24, 32, 48, 64, 128, 256, 512 | `default<size>.png` in the branding dir; Linux icons, about: artwork |
| `logo.png` | 512×512 | source for `content/about-logo.png` (512) and `about-logo@2x.png` (1024) |
| `logo-mac.png` | 512×512 | converted to `firefox.icns` — the macOS app icon |
| `firefox.ico` | 16/32/48/256 | Windows app icon |
| `firefox64.ico` | 64 | Windows app icon (64px) |

`logo.png` and `logo-mac.png` are currently copies of `logo512.png`; supply a
Mac-specific version if you want macOS-style padding/rounding.

Regenerate the build's branding after replacing art:

```
surfer import && surfer build
```
