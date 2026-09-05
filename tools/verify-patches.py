#!/usr/bin/env python3
"""Assert that every src/**/*.patch actually reached the engine tree.

    python3 tools/verify-patches.py [--src src] [--engine engine]

WHY THIS EXISTS
`git apply` silently does nothing when it is run from a subdirectory of a
repository and the patch's paths point outside that subdirectory:

    $ cd outer/engine && git apply ../p.patch
    Skipped patch 'browser/target.txt'.
    $ echo $?
    0

Surfer runs `git apply` with cwd=engine/. Locally engine/ has its own .git, so
it IS the repo root and patches apply. In CI it does not, so engine/ is just an
(ignored) subdirectory of the checkout, every patch is skipped, and the exit
code is still 0 -- Surfer prints "[FINISH] Apply <patch>" for all of them.

The result: v1.0.0 and v1.0.1 shipped with NONE of the 11 source patches --
Firefox View instead of the Home button, no tab-drag pinning, updates pointed
at Mozilla, and the packaging fix absent. Nothing anywhere reported an error.

The workflow now `git init`s engine/ before importing. This check is the
backstop, and it is CONTENT-based on purpose: `git apply --check -R` would
itself be skipped in the broken configuration and report success.
"""
import argparse, os, sys

def changed_lines(patch_path):
    """-> {target_path: ([added lines], [removed lines])}"""
    out, target = {}, None
    for line in open(patch_path, encoding="utf-8", errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("+++ "):
            p = line[4:].strip()
            if p.startswith("b/"): p = p[2:]
            target = None if p == "/dev/null" else p
            out.setdefault(target, ([], []))
        elif target and line.startswith("+") and not line.startswith("+++"):
            body = line[1:].strip()
            if len(body) >= 12 and any(c.isalnum() for c in body):
                out[target][0].append(body)
        elif target and line.startswith("-") and not line.startswith("---"):
            body = line[1:].strip()
            if len(body) >= 12 and any(c.isalnum() for c in body):
                out[target][1].append(body)
    return {k: v for k, v in out.items() if k and (v[0] or v[1])}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="src")
    ap.add_argument("--engine", default="engine")
    a = ap.parse_args()

    patches = []
    for root, _, files in os.walk(a.src):
        for f in files:
            if f.endswith(".patch"):
                patches.append(os.path.join(root, f))
    if not patches:
        print(f"::error::no .patch files under {a.src}")
        return 1
    patches.sort()

    failed = []
    for patch in patches:
        targets = changed_lines(patch)
        if not targets:
            print(f"  ?? {patch}: no distinctive added lines to check -- skipped")
            continue
        for target, (lines, gone) in targets.items():
            dest = os.path.join(a.engine, target)
            if not os.path.exists(dest):
                failed.append(f"{patch}: target {target} does not exist in the engine tree")
                continue
            body = open(dest, encoding="utf-8", errors="replace").read()
            if lines:
                # a patch counts as applied if MOST of its distinctive added
                # lines landed; a few may be reflowed by --ignore-space-change
                hits = sum(1 for l in lines[:12] if l in body)
                checked = min(len(lines), 12)
                if hits == 0:
                    failed.append(f"{patch}: NONE of {checked} added lines are in {target} -- patch was not applied")
                elif hits < checked / 2:
                    failed.append(f"{patch}: only {hits}/{checked} added lines found in {target} -- partially applied?")
                else:
                    print(f"  ok {os.path.relpath(patch, a.src)} -> {target} (+{hits}/{checked})")
            else:
                # Removal-only hunk: the deleted lines should be GONE. Judge on
                # the MAJORITY, not on every line: a removed line is often
                # generic boilerplate ("onPick: (_queryContext, controller) => {")
                # that legitimately still appears elsewhere in the same file for
                # a different entry, which made an applied patch look unapplied.
                checked = min(len(gone), 12)
                still = [l for l in gone[:12] if l in body]
                if len(still) > checked / 2:
                    failed.append(f"{patch}: {len(still)}/{checked} line(s) it removes are still in {target} -- patch was not applied")
                else:
                    print(f"  ok {os.path.relpath(patch, a.src)} -> {target} (-{checked - len(still)}/{checked} removed)")

    if failed:
        for f in failed:
            print(f"::error::{f}")
        print(f"\n{len(failed)} patch target(s) not applied. If this is CI, engine/ probably "
              "has no .git of its own, so `git apply` skipped every patch and still exited 0.")
        return 1
    print(f"\nAll {len(patches)} source patches verified present in the engine tree.")
    return 0

sys.exit(main())
