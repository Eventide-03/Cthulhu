#!/usr/bin/env python3
"""Generate Firefox-format update manifests for static hosting on GitHub Pages.

The browser requests

    /updates/<channel>/<BUILD_TARGET>/update.xml?product=..&version=..&...

GitHub Pages serves the file addressed by the PATH and ignores the query string,
so only <channel> and <BUILD_TARGET> need real files -- a finite set -- while
every standard Firefox parameter is still transmitted.

One always-latest manifest per target is enough: a client already on the
advertised version compares versions and simply does not update.

Run with --none to publish "no update available" manifests and pause a rollout.
"""

import argparse
import hashlib
import pathlib
import sys
from xml.sax.saxutils import quoteattr

# BUILD_TARGET is Services.appinfo.OS + "_" + UpdateUtils.ABI, and ABI reports
# the architecture the build is RUNNING ON, not what it was built for. So one
# universal macOS artifact must be advertised under BOTH Mac targets, and the
# x64 Windows build is also what an ARM64 Windows machine runs (emulated).
TARGETS = {
    "macos": ["Darwin_aarch64-gcc3", "Darwin_x86_64-gcc3"],
    "windows": ["WINNT_x86_64-msvc-x64", "WINNT_x86_64-msvc-aarch64"],
}

NO_UPDATE = '<?xml version="1.0" encoding="UTF-8"?>\n<updates>\n</updates>\n'


def manifest(display_version, app_version, platform_version, build_id,
             url, sha512, size):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<updates>\n"
        "  <update "
        'type="minor" '
        f"displayVersion={quoteattr(display_version)} "
        f"appVersion={quoteattr(app_version)} "
        f"platformVersion={quoteattr(platform_version)} "
        f"buildID={quoteattr(build_id)}>\n"
        "    <patch "
        'type="complete" '
        f"URL={quoteattr(url)} "
        'hashFunction="sha512" '
        f"hashValue={quoteattr(sha512)} "
        f"size={quoteattr(str(size))}/>\n"
        "  </update>\n"
        "</updates>\n"
    )


def digest(path):
    h = hashlib.sha512()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest(), path.stat().st_size


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=pathlib.Path,
                    help="Pages updates root, e.g. docs/updates")
    ap.add_argument("--channel", default="release")
    ap.add_argument("--none", action="store_true",
                    help='Publish "no update available" for every target (pause a rollout)')
    ap.add_argument("--version", help="Display/app version, e.g. 1.2.0")
    ap.add_argument("--platform-version", default="153.0")
    ap.add_argument("--build-id", help="14-digit buildid from the build")
    for plat in TARGETS:
        ap.add_argument(f"--{plat}-mar", type=pathlib.Path,
                        help=f"Path to the signed {plat} complete MAR (for hash+size)")
        ap.add_argument(f"--{plat}-url", help=f"Public download URL for the {plat} MAR")
        ap.add_argument(f"--{plat}-buildid",
                        help=f"buildID of the {plat} build (defaults to --build-id)")
    args = ap.parse_args()

    root = args.out / args.channel
    written = []

    if args.none:
        for targets in TARGETS.values():
            for t in targets:
                d = root / t
                d.mkdir(parents=True, exist_ok=True)
                (d / "update.xml").write_text(NO_UPDATE)
                written.append(d / "update.xml")
        print(f"Wrote {len(written)} NO-UPDATE manifests under {root}")
        for w in written:
            print(f"  {w}")
        return 0

    missing = [f"--{k}" for k in ("version", "build_id") if not getattr(args, k)]
    if missing:
        ap.error("required unless --none: " + ", ".join(missing))

    for plat, targets in TARGETS.items():
        mar = getattr(args, f"{plat}_mar")
        url = getattr(args, f"{plat}_url")
        if not mar or not url:
            print(f"  skipping {plat}: no MAR/URL supplied", file=sys.stderr)
            continue
        if not mar.is_file():
            ap.error(f"{mar} does not exist")
        sha512, size = digest(mar)
        build_id = getattr(args, f"{plat}_buildid") or args.build_id
        xml = manifest(args.version, args.version, args.platform_version,
                       build_id, url, sha512, size)
        for t in targets:
            d = root / t
            d.mkdir(parents=True, exist_ok=True)
            (d / "update.xml").write_text(xml)
            written.append(d / "update.xml")
        print(f"  {plat}: {mar.name} buildid={build_id} sha512={sha512[:16]}... "
              f"size={size} -> {len(targets)} targets")

    if not written:
        ap.error("nothing written -- supply at least one --<platform>-mar/--<platform>-url pair")
    print(f"Wrote {len(written)} manifests under {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
