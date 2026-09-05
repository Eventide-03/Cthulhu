#!/usr/bin/env python3
"""Assert that a PACKAGED build actually contains Cthulhu.

    python3 tools/verify-package.py <resources-dir> [--surfer surfer.json]

<resources-dir> is the directory holding omni.ja and browser/omni.ja --
Cthulhu.app/Contents/Resources on macOS, the packaged tree root on Windows.

WHY THIS EXISTS
browser/installer/package-manifest.in is an ALLOWLIST: `mach package` copies
only the paths named in it. Nothing warns about a path that is missing from it,
so v1.0.0 and the first v1.0.1 shipped -- on BOTH platforms -- with the entire
chrome://cthulhu package and cthulhu.js prefs silently dropped. The result was a
rebranded Firefox: white new tab, no widgets, no theme, no Home button, and Zen
Browser's onboarding (its branding prefs won unopposed).

A local `mach build` never runs the packager -- it uses loose files under
dist/bin -- so development is completely blind to this. Only a packaged build
shows it, which is why it must be checked in CI on the packaged artifact.
"""
import argparse, json, os, sys, zipfile

def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("resources")
    ap.add_argument("--surfer", default="surfer.json")
    a = ap.parse_args()

    gre = os.path.join(a.resources, "omni.ja")
    brw = os.path.join(a.resources, "browser", "omni.ja")
    appini = os.path.join(a.resources, "application.ini")
    for p in (gre, brw, appini):
        if not os.path.exists(p):
            fail(f"not a packaged tree: {p} is missing")

    ok = True

    # 1. the chrome package itself
    z = zipfile.ZipFile(gre)
    names = z.namelist()
    chrome = [n for n in names if n.startswith("chrome/cthulhu/")]
    if len(chrome) < 20:
        fail(f"omni.ja carries only {len(chrome)} chrome/cthulhu/ entries -- the "
             "chrome://cthulhu package was dropped by the packager. Check that "
             "package-manifest.in lists chrome/cthulhu@JAREXT@ and chrome/cthulhu.manifest.")
    print(f"OK: chrome://cthulhu package present ({len(chrome)} files)")

    # 2. registered, not merely present
    try:
        manifest = z.read("chrome/chrome.manifest").decode()
    except KeyError:
        fail("omni.ja has no chrome/chrome.manifest")
    if "content cthulhu " not in manifest:
        fail("chrome.manifest does not register the cthulhu package -- "
             "chrome://cthulhu/ URLs would not resolve")
    print("OK: chrome://cthulhu registered in chrome.manifest")

    # 3. our default prefs (without these, the generated branding prefs win and
    #    the browser greets the user as Zen)
    if "defaults/preferences/cthulhu.js" not in zipfile.ZipFile(brw).namelist():
        fail("browser/omni.ja is missing defaults/preferences/cthulhu.js -- "
             "Cthulhu's default prefs would not load")
    print("OK: cthulhu.js default prefs present")

    # 4. updates must point at us, not Mozilla
    host = json.load(open(a.surfer))["updateHostname"]
    url = ""
    for line in open(appini, encoding="utf-8", errors="replace"):
        if line.startswith("URL="):
            url = line.strip()[4:]
            break
    if not url:
        fail("application.ini has no [AppUpdate] URL")
    if "aus5.mozilla.org" in url or host not in url:
        fail(f"AppUpdate URL is {url!r} -- expected host {host}. Updates would go to Mozilla.")
    print(f"OK: updates resolve to {host}")

    print("Package verified.")

main()
