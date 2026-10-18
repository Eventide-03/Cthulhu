#!/bin/bash
# =============================================================================
# Cthulhu ESR rebase helper. See RELEASE.md for the full release loop.
#
#   tools/rebase-esr.sh check          is a newer ESR available? (exit 10 = yes)
#   tools/rebase-esr.sh audit          test-apply every patch, show vendored drift
#   tools/rebase-esr.sh rebase <ver>   e.g. `rebase 153.1.0esr` -- DESTRUCTIVE:
#                                      wipes engine/ and re-downloads Firefox
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PD_URL="https://product-details.mozilla.org/1.0/firefox_versions.json"

current_version() {
  python3 -c "import json;print(json.load(open('surfer.json'))['version']['version'])"
}

cmd_check() {
  local cur pd; cur=$(current_version)
  echo "ours    : $cur"
  # NOTE: fetched into a variable, NOT piped -- a heredoc script consumes stdin,
  # so `curl | python3 - <<PY` silently hands python an empty stream.
  pd=$(curl -fsS "$PD_URL")
  python3 - "$cur" "$pd" <<'PY'
import json, re, sys
cur = sys.argv[1]
d = json.loads(sys.argv[2])
def parse(v):
    return [int(x) for x in re.findall(r"\d+", (v or "").replace("esr", ""))] or [0]
cands = {k: d[k] for k in ("FIREFOX_ESR", "FIREFOX_ESR_NEXT") if d.get(k)}
for k, v in cands.items():
    print(f"{k:8}: {v}")
newer = sorted({v for v in cands.values() if parse(v) > parse(cur)}, key=parse)
ours_line = parse(cur)[0]
lines = {parse(v)[0] for v in cands.values()}
if ours_line not in lines:
    print(f"WARNING: our ESR line ({ours_line}) is in neither slot -- it may be end-of-life.")
if newer:
    print(f"NEWER ESR AVAILABLE: {', '.join(newer)}")
    print(f"  next: tools/rebase-esr.sh rebase {newer[0]}")
    sys.exit(10)
print("up to date")
PY
}

cmd_audit() {
  echo "== git-format patches (the conflict-prone kind) =="
  local fail=0 p abs state
  while IFS= read -r p; do
    abs="$PWD/$p"
    if git -C engine apply --check "$abs" 2>/dev/null; then
      state="applies cleanly (not yet applied)"
    elif git -C engine apply --check --reverse "$abs" 2>/dev/null; then
      state="already applied"
    else
      # Fails both directions: either a genuine conflict with new upstream, or
      # the engine is simply STALE (src/ patch updated, `surfer import` not yet
      # re-run). After a fresh `surfer download --force` it is always the former.
      state="DOES NOT APPLY (conflict, or stale engine -- re-run surfer import)"
      fail=1
    fi
    printf '  %-52s %s\n' "$p" "$state"
  done < <(git ls-files src | grep '\.patch$')

  echo
  echo "== vendored full-file copies (surfer import OVERWRITES upstream with these;"
  echo "   they never 'conflict' -- they silently revert upstream changes instead) =="
  if [ -f engine/build/application.ini.in ]; then
    # Our copy is upstream + a header + one URL line; anything beyond that is drift.
    # Compare with comments/blanks stripped from BOTH sides, so only effective
    # config lines count. The sole intended difference is the [AppUpdate] URL.
    local drift
    drift=$(diff <(git -C engine show HEAD:build/application.ini.in 2>/dev/null | grep -vE '^;|^$') \
                 <(grep -vE '^;|^$' src/build/application.ini.in) | grep -c '^[<>]' || true)
    printf '  %-52s %s differing effective lines vs upstream (expected: 2 -- the URL swap)\n' \
      "src/build/application.ini.in" "$drift"
    [ "$drift" -le 2 ] || { echo "    !! more drift than the URL swap accounts for -- re-sync it (rebase does this automatically)"; fail=1; }
  fi
  echo "  src/toolkit/mozapps/update/updater/*.der          OUR MAR certs -- intentional, never re-sync"
  [ "$fail" -eq 0 ] || { echo; echo "AUDIT FAILED"; return 1; }
  echo
  echo "audit clean"
}

regen_application_ini() {
  # Rebuild the vendored application.ini.in from the FRESH upstream file,
  # re-applying only what is ours -- the header comment and the [AppUpdate] URL
  # line, both taken from the COMMITTED copy -- so a rebase can never silently
  # revert new upstream fields, and can never bring back an old URL either.
  # (An earlier version wrote a hard-coded URL template here; by the time of the
  # 153.5 rebase that template was two decisions stale -- the @MOZ_APPUPDATE_HOST@
  # placeholder the host no longer comes from, and the query parameters removed as
  # fingerprint -- and would have shipped a browser that could not find updates.)
  # Upstream is read from engine/'s git HEAD, not the working tree: after an
  # import, engine/build/application.ini.in is a symlink to our own copy.
  python3 - <<'PY'
import io, subprocess
up = subprocess.run(["git", "-C", "engine", "show", "HEAD:build/application.ini.in"],
                    capture_output=True, text=True, check=True).stdout
ours = io.open("src/build/application.ini.in", encoding="utf8").read()
first = up.split("\n", 1)[0]
cut = ours.find(first + "\n")
assert cut > 0, "could not find where upstream's text begins in src/build/application.ini.in"
header = ours[:cut]
url = [ln for ln in ours.split("\n") if ln.startswith("URL=") and "update.xml" in ln]
assert len(url) == 1, f"expected exactly 1 update URL line in our copy, found {len(url)}"
# Our own ';' comment block directly above [AppUpdate] (why the host is literal).
ol = ours.split("\n")
i = ol.index("[AppUpdate]")
j = i
while j > 0 and ol[j - 1].startswith(";"):
    j -= 1
note = ol[j:i]
out, n = [], 0
for ln in up.split("\n"):
    if ln == "[AppUpdate]":
        out.extend(note)
    if ln.startswith("URL=") and "update.xml" in ln:
        out.append(url[0]); n += 1
    else:
        out.append(ln)
assert n == 1, f"expected exactly 1 update URL line in upstream file, found {n}"
new = header + "\n".join(out)
changed = new != ours
io.open("src/build/application.ini.in", "w", encoding="utf8").write(new)
print("  regenerated src/build/application.ini.in from fresh upstream "
      + ("(upstream changed -- review the diff)" if changed else "(no upstream change)"))
PY
}

cmd_rebase() {
  local ver="${1:?usage: tools/rebase-esr.sh rebase <version, e.g. 153.1.0esr>}"
  echo "!! DESTRUCTIVE: 'surfer download --force' wipes engine/ (your build objdirs too)."
  read -r -p "Rebase to $ver? [y/N] " a
  [ "$a" = "y" ] || exit 1

  python3 - "$ver" <<'PY'
import json, sys
d = json.load(open("surfer.json"))
d["version"]["version"] = sys.argv[1]
d["version"]["candidate"] = sys.argv[1]
json.dump(d, open("surfer.json", "w"), indent=2)
print(f"  surfer.json -> {sys.argv[1]}")
PY

  surfer download --force
  regen_application_ini
  echo
  cmd_audit || echo "(conflicts above must be fixed before import)"
  echo
  surfer import
  cat <<'DONE'

Rebase applied. Remaining MANUAL steps (see RELEASE.md):
  1. surfer build --skip-patch-check  -- expect API breakage on major jumps
  2. Verify: UA still "Firefox/<ver>" in about:support; Home tab; side panels;
     about:cthulhu widgets; an update check against the old manifests
  3. Commit, bump displayVersion, tag, push
DONE
}

case "${1:-}" in
  check)  cmd_check ;;
  audit)  cmd_audit ;;
  rebase) shift; cmd_rebase "$@" ;;
  *) grep '^#   tools' "$0" | sed 's/^# *//'; exit 1 ;;
esac
