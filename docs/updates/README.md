# Update service

Cthulhu's update service is **static XML on GitHub Pages** — no server, no cost.

## How the browser finds it

`src/build/application.ini.in` sets the update URL to:

```
https://eventide-03.github.io/Cthulhu/updates/%CHANNEL%/%BUILD_TARGET%/update.xml
  ?product=%PRODUCT%&version=%VERSION%&buildid=%BUILD_ID%&os=%OS_VERSION%&locale=%LOCALE%
```

**Why the parameters are in the query string.** Firefox's stock URL puts
`%VERSION%`, `%BUILD_ID%` and `%OS_VERSION%` in the *path*. Those vary per
client, so a static host would need a file for every combination — impossible.
Pages serves the file addressed by the path and ignores the query, so keeping
only `%CHANNEL%` and `%BUILD_TARGET%` in the path gives a finite set of
manifests while every standard parameter is still transmitted.

## Layout

```
docs/updates/
└── release/                          ← %CHANNEL%
    ├── Darwin_aarch64-gcc3/update.xml     macOS on Apple Silicon
    ├── Darwin_x86_64-gcc3/update.xml      macOS on Intel
    ├── WINNT_x86_64-msvc-x64/update.xml   Windows x64 on x64
    └── WINNT_x86_64-msvc-aarch64/update.xml   Windows x64 on ARM64 (emulated)
```

### Why four targets for two artifacts

`BUILD_TARGET` is `Services.appinfo.OS + "_" + UpdateUtils.ABI`, and **ABI
reports the architecture the build is *running on*, not the one it was built
for** (`UpdateUtils.sys.mjs`). So:

- The **one universal** macOS `.app` reports `Darwin_aarch64-gcc3` on Apple
  Silicon and `Darwin_x86_64-gcc3` on Intel. Both point at the *same* universal
  MAR.
- On Windows the ABI gets the running CPU appended, so the x64 build reports
  `-x64` on an x64 machine and `-aarch64` on an ARM64 machine running it under
  emulation. Both point at the same x64 MAR.

Missing any of these means those users silently never get updates.

## One always-latest manifest per target

Each manifest advertises the newest version. A client already on it compares
versions and does not update, so there is no need for per-version manifests.

## Generating

```bash
python3 tools/update-manifests/generate.py \
  --out docs/updates --channel release \
  --version 1.2.0 --build-id 20260825120000 --platform-version 153.0 \
  --macos-mar   dist/Cthulhu-1.2.0-macos-universal.complete.mar \
  --macos-url   https://github.com/Eventide-03/Cthulhu/releases/download/v1.2.0/Cthulhu-1.2.0-macos-universal.complete.mar \
  --windows-mar dist/Cthulhu-1.2.0-windows-x64.complete.mar \
  --windows-url https://github.com/Eventide-03/Cthulhu/releases/download/v1.2.0/Cthulhu-1.2.0-windows-x64.complete.mar
```

Hashes and sizes are computed from the MAR files, so they cannot drift from what
is actually published.

## Pausing a rollout

```bash
python3 tools/update-manifests/generate.py --out docs/updates --none
git commit -am "Pause update rollout" && git push
```

That writes an empty `<updates></updates>` to every target — the valid Firefox
way to say "no update available". Clients stop being offered the update within
one check cycle. Re-run the normal command to resume.

## Ordering rule

**The MAR must be published before the manifest that references it.** The
release workflow uploads MARs as release assets first and only then commits the
manifests, so a client can never see a manifest pointing at a missing file.

## Signing

Every MAR is signed with the Cthulhu MAR key and **verified before publishing**;
the build fails if verification fails. The browser only accepts MARs signed by
that key — Mozilla's certificates are replaced in
`src/toolkit/mozapps/update/updater/`. See [../../SECURITY.md](../../SECURITY.md).
