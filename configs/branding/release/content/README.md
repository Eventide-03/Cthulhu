# Branding `content/` — art slot

This directory **must exist**: Surfer's `addOptionalIcons()` calls
`readdirSync(<branding>/content)` unconditionally, so `surfer build` fails with
ENOENT if it is missing — even when empty.

Anything dropped here is copied into `engine/browser/branding/nightly/content/`.

Surfer already generates `about-logo.png` (512×512) and `about-logo@2x.png`
(1024×1024) from `../logo.png`, so you only need files here to **override** those
or to add extras (e.g. `aboutDialog.css`).
