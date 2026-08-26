# Windows code signing

**Status: Cthulhu's Windows builds are unsigned, deliberately.** This document
records why, what that costs users, and what adopting OSSign would involve if
that decision is ever revisited.

**Nothing here is implemented.** It is research, not a plan of record.

## Current position

We do not pay for an Authenticode certificate. A standard OV certificate runs
roughly $200–500/year and an EV certificate (the kind that gets SmartScreen
reputation immediately) more, typically with a hardware token or cloud HSM
attached. For a one-person hobby fork that is not a sensible spend.

The build workflow has **no** signing step, and
[`.github/workflows/build.yml`](../.github/workflows/build.yml) carries a
comment block saying so explicitly, so nobody later "fixes" it by adding one.

### What it costs users

Windows SmartScreen shows **"Windows protected your PC"** when an unsigned
executable is downloaded and run. Users must click **More info** → **Run
anyway**. The download page explains this, and must keep doing so.

Two things worth being clear-eyed about:

- **Signing would not make that warning disappear immediately.** SmartScreen
  reputation accrues *per certificate*, based on how many users run binaries
  signed with it. A fresh OV certificate starts with none, so the warning
  persists until reputation builds. Only EV certificates skip that ramp.
  LibreWolf — which *is* signed via OSSign — still sees SmartScreen warnings
  reported by users.
- So adopting OSSign would be an improvement in *provenance* (the installer is
  verifiably unmodified, and the UAC prompt names a publisher instead of saying
  "Unknown"), not an instant fix for the scary dialog.

## OSSign

[OSSign](https://ossign.org/) provides free code signing to qualifying open
source projects. It is run by a group in Sweden — maintainer `scheibling`,
backed by Scheibling Consulting AB, Cloudyne Systems, and Clysec. Their GitHub
org describes it as *"Code-, Binary- and Driver Signing for Open Source
Projects"*.

**LibreWolf uses it for their Windows binaries**, which is the strongest
available evidence that a Firefox fork is an acceptable applicant. Their
Windows signing work ran from roughly December 2025 to April 2026
([codeberg issue #2664](https://codeberg.org/librewolf/issues/issues/2664)).
They sign the program, portable, setup, and winupdater executables.

Other projects in the org's signed list include LibrePCB, Beaver Notes,
usbip-win2, and an Intel network driver — a mix of applications and drivers,
which suggests they are not narrowly scoped to one kind of software.

### What applying would involve

Based on what could be verified from public sources:

1. **Apply via [ossign.org](https://ossign.org/).** There is no public
   self-service application repo or issue template — the org page directs
   applicants to the website, and it appears to operate through direct contact.
2. **Approval issues credentials.** The signing request takes a **username and
   key/token**, supplied once an application is approved.
3. **Expect a test certificate first.** LibreWolf received a Windows *test*
   certificate initially — it signs, but Microsoft does not trust it — followed
   by production certificates once the integration worked.
4. **Wire it into CI.** OSSign publishes GitHub Actions:
   - `ossign/actions/workflow/dispatch@main` — dispatches a signing job and
     retrieves the signed artifact. Takes `username` and `token`, supplied as
     repository secrets.
   - `ossign/actions/setup-ossign` — installs the OSSign CLI if you would
     rather drive signing directly.

   Sketch of where it would slot into our Windows job, after the installer is
   built and before upload:

   ```yaml
   - uses: ossign/actions/workflow/dispatch@main
     with:
       username: ${{ secrets.OSSIGN_USERNAME }}
       token: ${{ secrets.OSSIGN_TOKEN }}
   ```

   Because signing happens on OSSign's side, the unsigned installer is uploaded
   to them and a signed one comes back — so this must run **after** `mach build
   installer` and **before** the artifact upload and the release job.

5. **Decide what gets signed.** Following LibreWolf's lead that would be the
   installer (`setup.exe`), the main `Cthulhu.exe`, and — if we ever ship one —
   the updater. Signing only the installer leaves the installed binaries
   unsigned.

### Unverified

Be aware of the gaps before relying on any of this:

- **The published eligibility criteria could not be retrieved.** ossign.org is
  JavaScript-rendered and returned no readable content; the GitHub org and
  `.github` profile repo both defer to the website. "Qualifying open source
  projects" is the only stated bar found, with no definition of *qualifying*.
- **No terms, licence requirements, or renewal cadence were found.** Compare
  SignPath Foundation, which publishes explicit conditions.
- **Turnaround is unknown.** LibreWolf's took roughly four months end to end,
  but that includes their own CI work and does not separate application wait
  time from engineering time.
- **Trademark/attribution implications are unclear.** See below.

### Caveats worth weighing

- **The publisher name is OSSign's legal entity, not yours.** LibreWolf's UAC
  prompt reads *"Cloudyne Systems (Scheibling Consulting AB)"*, and they added
  an FAQ entry clarifying that LibreWolf is not developed by that company.
  Cthulhu would inherit the same confusion — users would see a Swedish
  consultancy named as the publisher of a browser called Cthulhu.
- **It is a dependency on a small volunteer operation.** If OSSign stops
  signing, builds revert to unsigned and users who had stopped seeing warnings
  start seeing them again.
- **Signing keys never touch our CI**, which is a genuine security *benefit*
  over holding a certificate ourselves — there is no key material in the repo
  or in Actions secrets to leak.

## Alternatives considered

| Option | Cost | Verdict |
| --- | --- | --- |
| **Stay unsigned** | Free | **Current choice.** SmartScreen warning, documented on the download page |
| **OSSign** | Free | Best free path to a real Authenticode signature; researched here, not adopted |
| **[SignPath Foundation](https://signpath.org/)** | Free for OSS | Comparable programme with *published* terms — worth comparing directly if this is pursued |
| **Azure Trusted Signing** | ~$10/mo | Cheapest paid route; requires a verifiable legal identity, which a pseudonymous personal project may not satisfy |
| **OV certificate** | ~$200–500/yr | Rejected: cost, and it still needs reputation to build |
| **EV certificate** | ~$400+/yr | Only option that skips the SmartScreen ramp; rejected on cost |
| **Sigstore** | Free | Not Authenticode — does nothing for SmartScreen. Useful for supply-chain attestation, orthogonal to this |
| **Self-signed** | Free | Pointless: not trusted, no better than unsigned |

## If we adopt this later

Rough order of work:

1. Apply at ossign.org; mention the LibreWolf precedent for a Firefox fork.
2. Add `OSSIGN_USERNAME` / `OSSIGN_TOKEN` as secrets in a **protected
   Environment**, so fork pull requests cannot reach them.
3. Insert the dispatch step in the Windows job between `mach build installer`
   and the artifact upload.
4. Replace the "intentionally unsigned" comment block in the workflow, and
   update this file.
5. **Keep the SmartScreen note on the download page** until reputation has
   actually built — remove it based on observed behaviour, not on the
   assumption that signing fixed it.

---

*Sources: [ossign.org](https://ossign.org/) ·
[OSSign on GitHub](https://github.com/ossign) ·
[OSSign/actions](https://github.com/OSSign/actions) ·
[LibreWolf issue #2664](https://codeberg.org/librewolf/issues/issues/2664) ·
[LibreWolf FAQ](https://librewolf.net/docs/faq/) ·
[SignPath Foundation](https://signpath.org/)*
