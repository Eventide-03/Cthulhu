#!/usr/bin/env bash
# Mirror src/theme into engine/theme as per-file symlinks.
#
# The local build reads the theme from engine/theme (mach's jar.mn lives there
# via src/moz-build.patch), and that tree is a mirror of src/theme made of one
# symlink per file, so an edit in src/ is live without copying. A NEW file,
# though, has no symlink until something makes one -- `mach build faster` then
# fails with "No such file or directory" for it -- and a deleted file leaves a
# dangling link behind. This keeps the two in step: adds missing links, points
# stale ones at the right file, removes links whose target is gone, and
# reports what it did so the caller knows whether the FasterMake backend has
# to be regenerated (it does whenever a file was added or removed).
#
#   ./tools/sync-mirror.sh          # prints one line per change; exit 0
#   changed=$(./tools/sync-mirror.sh | wc -l)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD/src/theme"
DST="$PWD/engine/theme"
[ -d engine ] || { echo "no engine/ checkout here" >&2; exit 1; }
mkdir -p "$DST"

# add / repoint
find "$SRC" -type f -not -name ".DS_Store" | while read -r f; do
  rel="${f#"$SRC"/}"
  d="$DST/$rel"
  if [ -L "$d" ] && [ "$(readlink "$d")" = "$f" ]; then continue; fi
  mkdir -p "$(dirname "$d")"
  rm -rf "$d"
  ln -s "$f" "$d"
  echo "+ $rel"
done

# prune: dangling links, then directories left empty
find "$DST" -type l | while read -r l; do
  if [ ! -e "$l" ]; then rm -f "$l"; echo "- ${l#"$DST"/}"; fi
done
find "$DST" -mindepth 1 -type d -empty -delete 2>/dev/null || true
