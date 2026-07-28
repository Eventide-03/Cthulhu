#!/usr/bin/env bash
#
# bench/measure.sh — repeatable memory/CPU benchmark for the built browser.
#
# Launches the built browser with a fixed 5-tab workload in a throwaway profile,
# lets it settle, then sums RSS across ALL of the browser's processes (parent +
# content/GPU/utility children) and reports total MB, the process count, and the
# aggregate CPU. Intended for before/after comparisons (e.g. a debloat pass).
#
# Usage:
#   bash bench/measure.sh                                  # print report to stdout
#   bash bench/measure.sh | tee bench/baseline-before.txt  # save a run
#   SETTLE=45 bash bench/measure.sh                        # override settle seconds
#
# Notes:
#   * Uses the built .app binary directly (not `surfer run`) so we can pin a fixed
#     profile + tab set for repeatability. `surfer run` uses an ephemeral profile
#     and doesn't take our URLs cleanly.
#   * The instance is launched fresh and closed again at the end, so runs don't
#     accumulate. Nothing outside this build is touched.
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTLE="${SETTLE:-30}"

# Fixed tab set (the benchmark workload). Keep identical across before/after runs.
TABS=(
  "https://example.com"
  "https://wikipedia.org"
  "https://github.com"
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ"   # stable long-lived video (Big Buck Bunny)
  "about:blank"
)

# Locate the built browser binary. The bundle dir name (Nightly.app) may change
# after a rebrand, but the executable is always Contents/MacOS/Cthulhu (binaryName).
BIN="$(ls "$PROJECT_DIR"/engine/obj-*/dist/*.app/Contents/MacOS/Cthulhu 2>/dev/null | head -1)"
if [ -z "${BIN:-}" ] || [ ! -x "$BIN" ]; then
  echo "ERROR: built browser binary not found under engine/obj-*/dist/*.app/Contents/MacOS/Cthulhu" >&2
  echo "Build it first:  surfer build" >&2
  exit 1
fi
APP="$(cd "$(dirname "$BIN")/../.." && pwd)"   # .../dist/<App>.app  (prefix shared by all child procs)
MATCH="$APP"                                   # pgrep pattern: matches parent + plugin-container children

kill_instance() { pkill -f "$MATCH" 2>/dev/null || true; }

PROFILE=""
cleanup() {
  kill_instance
  sleep 2
  pkill -9 -f "$MATCH" 2>/dev/null || true
  [ -n "$PROFILE" ] && rm -rf "$PROFILE"
}
trap cleanup EXIT

# Ensure no earlier instance of THIS build skews the numbers.
if pgrep -f "$MATCH" >/dev/null 2>&1; then
  echo "note: an existing instance of this build was running; closing it for a clean measurement" >&2
  kill_instance; sleep 3
fi

# Fresh, isolated profile pre-seeded to open exactly our tab set and suppress
# first-run / onboarding / update tabs (so the tab count is deterministic).
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/cthulhu-bench.XXXXXX")"
HOMEPAGE="$(IFS='|'; echo "${TABS[*]}")"
cat > "$PROFILE/user.js" <<EOF
user_pref("browser.startup.page", 1);
user_pref("browser.startup.homepage", "$HOMEPAGE");
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.messaging-system.whatsNewPanel.enabled", false);
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("startup.homepage_override_url", "");
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
EOF

echo "== browser memory benchmark =="
echo "binary : $BIN"
echo "profile: $PROFILE (throwaway)"
echo "tabs   : ${#TABS[@]}"
for t in "${TABS[@]}"; do echo "         - $t"; done
echo "settle : ${SETTLE}s"
echo

# --- launch -----------------------------------------------------------------
"$BIN" -no-remote -foreground -profile "$PROFILE" >/dev/null 2>&1 &
disown "$!" 2>/dev/null || true   # don't let the shell print "Terminated" when teardown kills it
echo "launched; waiting ${SETTLE}s for tabs to load and settle..." >&2
sleep "$SETTLE"

# --- collect all of the browser's processes ---------------------------------
PIDS="$(pgrep -f "$MATCH" | sort -un)"
if [ -z "$PIDS" ]; then
  echo "ERROR: no browser processes found after launch (did it start?)." >&2
  exit 1
fi
PID_CSV="$(echo "$PIDS" | paste -sd, -)"
COUNT="$(echo "$PIDS" | wc -l | tr -d ' ')"
RSS_KB="$(ps -o rss= -p "$PID_CSV" 2>/dev/null | awk '{s+=$1} END{print s+0}')"
RSS_MB="$(awk "BEGIN{printf \"%.1f\", $RSS_KB/1024}")"
CPU_SUM="$(ps -o %cpu= -p "$PID_CSV" 2>/dev/null | awk '{s+=$1} END{printf "%.1f", s+0}')"

# --- report -----------------------------------------------------------------
echo "== results =="
echo "timestamp     : $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "process count : $COUNT"
echo "total RSS     : ${RSS_MB} MB  (${RSS_KB} KB summed via ps -o rss=)"
echo "aggregate CPU : ${CPU_SUM}%   (sum of ps %cpu across all browser processes)"
echo
echo "per-process (pid / RSS MB / %cpu / command):"
ps -o pid=,rss=,%cpu=,comm= -p "$PID_CSV" 2>/dev/null \
  | awk '{cmd=""; for(i=4;i<=NF;i++){cmd=cmd (i>4?" ":"") $i} printf "  %-7s %8.1f  %6s  %s\n", $1, $2/1024, $3, cmd}' \
  | sort -k2 -nr
echo
echo "note: the YouTube tab can keep CPU/RSS from being fully idle (media decode);"
echo "      what matters is that the workload is identical across before/after runs."
