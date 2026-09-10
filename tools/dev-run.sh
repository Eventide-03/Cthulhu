#!/usr/bin/env bash
# Run the LOCAL build, and stop it from replacing itself with a release.
#
# WHY THIS EXISTS
# ---------------
# A local build reports whatever version `configure` last baked in -- usually an
# old one, because re-running configure to bump it means a full relink. The
# published update manifest advertises the newest RELEASE. So the dev build sees
# a newer version, downloads the release MAR and applies it over
# dist/Cthulhu.app: the loose chrome files are replaced by the release's
# omni.ja, application.ini is rewritten, and everything you were working on
# stops being what runs. That is not hypothetical -- it happened, and it takes
# the whole day's work with it.
#
# It got much easier to trigger when app.update.checkInstallTime.days went to 0
# (ship-side that is deliberate: releases should reach people at the next
# launch), because the dev build now checks on EVERY start rather than waiting
# for the six-hourly timer.
#
# The fix is a policy, because there is no pref for this: nsUpdateService reads
# `Services.policies.isAllowed("appUpdate")`, and DisableAppUpdate turns that
# off at the source, before any check or download. The file goes in the GRE
# directory's `distribution/` folder (XREAppDist -- see
# EnterprisePoliciesParent.sys.mjs), and `make repackage` does not preserve it,
# so it is rewritten here on every run.
#
#   ./tools/dev-run.sh              build, repackage, then run
#   ./tools/dev-run.sh --no-build   just run what is already built
#   ./tools/dev-run.sh -- -private  anything after -- goes to the browser
set -euo pipefail

cd "$(dirname "$0")/.."
OBJ="engine/obj-aarch64-apple-darwin25.5.0"
APP="$OBJ/dist/Cthulhu.app"
BUILD=1
[ "${1:-}" = "--no-build" ] && { BUILD=0; shift; }
[ "${1:-}" = "--" ] && shift

if [ "$BUILD" = 1 ]; then
  # New or removed files under src/theme need their mirror symlinks in
  # engine/theme and a regenerated FasterMake backend, or `build faster` fails
  # on the missing file. sync-mirror prints one line per change.
  echo "==> sync engine/theme mirror"
  if [ -n "$(./tools/sync-mirror.sh | tee /dev/stderr)" ]; then
    echo "==> mach build-backend -b FasterMake (files were added or removed)"
    (cd engine && ./mach build-backend -b FasterMake >/dev/null)
  fi
  echo "==> mach build faster"
  (cd engine && ./mach build faster)
  echo "==> repackage"
  make -C "$OBJ/browser/app" repackage >/dev/null
fi

[ -x "$APP/Contents/MacOS/Cthulhu" ] || { echo "No build at $APP -- run a full build first." >&2; exit 1; }

# Belt and braces alongside the policy: if a release ever DID get staged, this
# is where it would sit waiting to be applied on the next start.
STAGED="$HOME/Library/Caches/Mozilla/updates/$(cd "$(dirname "$APP")" && pwd)"
if [ -d "$STAGED" ] && find "$STAGED" -name update.status -o -name '*.mar' | grep -q .; then
  echo "==> clearing a staged update under $STAGED"
  rm -rf "$STAGED"
fi

DIST="$APP/Contents/Resources/distribution"
mkdir -p "$DIST"
cat > "$DIST/policies.json" <<'JSON'
{
  "//": "LOCAL DEV ONLY -- written by tools/dev-run.sh, never shipped. Without this the dev build updates itself into a release and overwrites your work.",
  "policies": {
    "DisableAppUpdate": true
  }
}
JSON

VERSION=$(sed -n 's/^Version=//p' "$APP/Contents/Resources/application.ini" | head -1)
echo "==> launching $APP (reports version $VERSION; auto-update DISABLED by policy)"
exec "$APP/Contents/MacOS/Cthulhu" "$@"
