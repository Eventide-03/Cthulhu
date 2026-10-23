# Release loop

The whole loop, as a checklist. The only genuinely manual, security-critical
work is step 1 — everything after the tag is CI.

## 1. Rebase onto the newer Firefox ESR  ⚠️ security-critical

This is where Mozilla's security fixes reach your users. Until it ships, every
install is exposed to already-published advisories.

```bash
tools/rebase-esr.sh check                 # is there a newer ESR? (CI also watches weekly)
tools/rebase-esr.sh rebase 153.1.0esr     # DESTRUCTIVE: wipes engine/, re-downloads, re-imports
```

The script updates `surfer.json`, regenerates the vendored
`src/build/application.ini.in` from the fresh upstream (re-applying only our
update-URL line), audits every patch, and runs `surfer import`.

- [ ] Fix any patch the audit marks **DOES NOT APPLY**: hand-apply the change in
      `engine/`, then regenerate with `git -C engine diff --full-index <file> >
      src/<path>.patch`. (See the risk register below for which patches to expect
      trouble from.)
- [ ] `surfer build --skip-patch-check` — on a **major** jump (153 → next line)
      expect chrome-API breakage in our modules; fix in `src/theme/` (history:
      the 140→153 jump moved `CustomizableUI` to `moz-src:///` and removed
      `E10SUtils.getRemoteTypeForURI`).
- [ ] Smoke-test: UA shows standard `Firefox/<ver>` in about:support · Home tab
      survives a restart · side panels · about:cthulhu widgets · `about:cthulhu`
      console clean.

## 2. Feature changes

Normal dev on `src/` (see CONTRIBUTING.md). Nothing here touches the release
machinery.

## 3. Version, tag, push

- [ ] Bump `brands.release.release.displayVersion` in `surfer.json`
      (and `brands.stable` if you keep them in step).
- [ ] Commit everything. Working tree must be clean.
- [ ] Tag **matching the displayVersion** and push both:

```bash
git tag v1.2.0 && git push origin main v1.2.0
```

The tag/displayVersion match matters: the app's internal version comes from
`displayVersion` at build time, while manifests and artifact names come from the
tag. If they differ, update checks compare the wrong numbers.

## 3½. Start the Mac build runner

The macOS compile runs on **your own Apple Silicon Mac** (a self-hosted runner),
because GitHub's free Mac runners cannot finish a release build inside their
6-hour cap. Everything else — Windows, the Mac merge/signing job, the release —
stays on GitHub's runners, and the MAR signing key never reaches your Mac.

Start the runner before you push the tag, and stop it afterwards:

```bash
cd ~/actions-runner && ./run.sh      # Ctrl-C once the "macOS arm64" job is done
```

The job waits in the queue until the runner is online (GitHub drops a job that
has waited 24 hours). A build takes ~2h; the job deletes its ~20 GB workspace
when it ends.

**One-time setup**

1. GitHub → Settings → Actions → Runners → *New self-hosted runner* → macOS,
   ARM64. Run the commands it shows in `~/actions-runner` (not inside this
   repo). When `config.sh` asks for additional labels, enter
   `cthulhu-release` — the workflow only targets a runner carrying it. Do not
   install it as a service; start it by hand when releasing.
2. GitHub → Settings → Actions → General → *Approval for running fork pull
   request workflows from contributors* → **Require approval for all external
   contributors**. This is what stops a pull request from running its own
   workflow on your Mac. The default (first-time contributors only) is not
   enough once a self-hosted runner exists.

Jobs run as your macOS user. For stronger isolation, register the runner under
a separate standard account instead (it then needs its own rustup and Xcode
command-line tools).

## 4. What CI does on the tag (nothing for you to do)

```
macos job ──► arm64 build+package on YOUR Mac (self-hosted; Apple Silicon only since 1.0.8)
          ──► sign+notarize (only if Apple secrets set; else AD-HOC signed + warning:
              unsigned bundles cannot hold a mic/camera grant -- see CONTRIBUTING.md)
          ──► .dmg ─► complete MAR ─► signmar ─► VERIFY signature (fails build if bad)
windows job ► x64 build ─► NSIS installer (deliberately unsigned) ─► complete MAR ─► sign+verify
release job ► GitHub Release (assets first!) ─► update manifests ─► whatsnew page ─► commit to Pages
```

Ordering guarantee: MARs are published as release assets **before** the
manifests that reference them are committed, so no client can ever fetch a
manifest pointing at a missing file. A failed Windows job doesn't block the Mac
release; its manifests are left at the previous version.

Requires (once): `MAR_SIGNING_DB_B64` in GitHub Actions secrets — the build
**fails on purpose** without it rather than shipping a MAR clients would reject.

## 5. Verify the release actually reached clients

- [ ] Release page shows the `.dmg`, `.exe`, and both `.complete.mar` assets
      with SHA256s in the body.
- [ ] Manifests advertise the new version (all four targets; spot-check one):

```bash
curl -s https://eventide-03.github.io/Cthulhu/updates/release/Darwin_aarch64-gcc3/update.xml
```

- [ ] End-to-end on a machine with the **previous** version: set
      `app.update.log=true` in about:config, open About Cthulhu → it should
      find, download, and apply the update, restart, and open
      `/whatsnew/<version>/` once. (Unattended installs pick it up within ~a day
      via the background agent.)
- [ ] The endpoint-health workflow goes back to green on its next 6-hour tick.

## Pausing and rolling back

**Pause** (stop offering the current update, e.g. mid-incident):

```bash
python3 tools/update-manifests/generate.py --out docs/updates --none
git commit -am "Pause update rollout" && git push
```

Clients get a valid "no update" answer within one check cycle. Resume by
reverting that commit.

**Roll back a bad release** — revert the manifest commit CI made:

```bash
git revert <sha of "Publish update manifests for vX.Y.Z"> && git push
```

The previous manifests point at the previous release's MARs, which still exist
as release assets. **Know what this does and doesn't do:** it protects everyone
who hasn't updated yet. It does **not** downgrade anyone already on the bad
version — the updater never offers a lower version. To fix the already-updated,
ship a **higher**-versioned release built from the good code (bad `1.2.0` →
good `1.2.1`). Also delist the bad installers: `gh release edit vX.Y.Z
--draft`.

## Is my ESR line still supported?

- `tools/rebase-esr.sh check` warns when our line is in neither product-details
  slot (that means end-of-life: **no more security fixes**).
- The weekly `esr-check` workflow opens an issue on a new ESR, with an explicit
  EOL warning when applicable.
- Calendar: <https://wiki.mozilla.org/Release_Management/Calendar> — ESR lines
  overlap ~3 months when a new one starts; the yearly major rebase should land
  inside that window.

## Patch risk register

Mechanical state: `tools/rebase-esr.sh audit`. Judgment, per patch:

| Patch | Depth | Risk | JS-layer alternative? |
| --- | --- | --- | --- |
| `theme/**` (all modules/widgets) | chrome/JS | **none** | Already is the JS layer — this is the strategy |
| `browser-xhtml.patch` (2 tags in `<head>`) | browser chrome markup | medium | No — this 4-line hook is what bootstraps the JS layer; it's the one injection point worth owning |
| `moz-configure.patch` (vendor + UA token) | build config | medium | No — compile-time only |
| `browser/moz-build.patch` (prefs file) | build glue | low | No — default prefs need a build entry |
| root `moz-build.patch` (`DIRS += theme`) | build glue | low | No |
| `distribution/*.patch` (2) | build glue | low | No |
| `application.ini.in` (vendored full copy) | build config | was **high** (silent drift) | Neutralised: auto-regenerated from fresh upstream on every rebase, keeping our header and the committed update URL verbatim (the 153.5 rebase caught the old template re-adding a stale URL) |
| `dom/media/MediaManager-cpp.patch` (one condition) | engine C++ | low | No — it is the gate itself. Lets `CallerType::System` past the `audioCapture` pref so tab audio works with the pref at stock **off**. If it stops applying, re-make it by hand; **never** "fix" it by turning the pref on, which opens the capture to web pages |
| `updater/*.der` (MAR certs) | data | none | n/a — never re-sync |
| **`PopupNotifications-sys-mjs.patch`** | **toolkit/modules — deepest we have** | **high** | **Yes.** It adds one recognition branch to `_isActiveBrowser()` for side-panel browsers. The same result is achievable by wrapping `window.PopupNotifications._isActiveBrowser` at runtime from `side-panels.js` — zero rebase surface. Convert on whichever rebase it first conflicts, if not before. |
