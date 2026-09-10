#!/usr/bin/env bash
# Make the dev bundle's CONTENT-side actor modules real files.
#
# The local build's chrome tree is symlinks into src/ (see sync-mirror.sh), and
# that is fine for everything the parent process loads. A content process is
# sandboxed to the bundle, though, and cannot follow a symlink out of it: a
# JSWindowActorChild module fails with "Failed to load chrome://..." and the
# feature it carries silently does nothing in a dev build -- the player's
# volume slider and its position-from-the-element both went through that.
# Copying the child modules in place (they are small, and the parent-side
# symlinks stay live) lets the sandbox read them. Run after `build faster`
# and `repackage`; dev-run.sh does, and the tests do.
#
#   ./tools/dev-actors.sh            # copies whatever is stale; prints one line per copy
set -euo pipefail
cd "$(dirname "$0")/.."
OBJ="engine/obj-aarch64-apple-darwin25.5.0"
for root in "$OBJ/dist/bin/chrome/cthulhu" "$OBJ/dist/Cthulhu.app/Contents/Resources/chrome/cthulhu"; do
  [ -d "$root" ] || continue
  find "$root" -name "*Child.sys.mjs" | while read -r f; do
    # the bundle's chrome/cthulhu/ tree mirrors src/theme/ path for path
    src="src/theme/${f#*/chrome/cthulhu/}"
    [ -f "$src" ] || continue
    if [ -L "$f" ] || ! cmp -s "$src" "$f"; then
      rm -f "$f"
      cp "$src" "$f"
      echo "copied ${f#"$OBJ"/}"
    fi
  done
done
