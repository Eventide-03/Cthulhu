# Security Policy

Cthulhu is a **personal fork of Firefox ESR, maintained by one person as a
hobby project.** It is not a commercial product, it has no company behind it,
and it carries **no SLA of any kind** — not for response time, not for patch
turnaround, not for availability. Please calibrate your expectations
accordingly, and prefer upstream Firefox if you need guaranteed support.

## Reporting a vulnerability

Email: **`<SECURITY_CONTACT_PLACEHOLDER>`** *(replace with a real address before
publishing — an alias you can rotate is a good idea, since this file is public
and will be scraped)*

Please **do not open a public GitHub issue for a security problem.** Use the
email above, or GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Helpful things to include:

- What the issue is and roughly how severe you think it is
- Steps to reproduce, ideally with a minimal test case
- The Cthulhu version and platform (see **About Cthulhu**)
- Whether the issue is specific to Cthulhu or also affects upstream Firefox

### What to expect

These are **goals, not guarantees.** One person, working on this in spare time:

| Stage | Target |
| --- | --- |
| Acknowledge your report | within ~7 days |
| Initial assessment | within ~30 days |
| Fix for a Cthulhu-specific issue | best effort, prioritised by severity |
| Fix for an upstream Firefox issue | whenever the next ESR rebase lands (see below) |

If you have not heard back in 30 days, assume the message was missed and feel
free to send a polite follow-up. If a report goes unanswered and you want to
disclose publicly, please do — you are not obliged to wait indefinitely on an
unresponsive hobby project. A heads-up first is appreciated.

## Supported versions

**Only the latest release is supported.** There are no long-term support
branches, and no backports to older Cthulhu builds. If you are not on the most
recent release, upgrading is the first step for any security concern.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Anything older | ❌ |

## Relationship to upstream Firefox

Cthulhu tracks **Firefox ESR** (currently **153 ESR**) and gets the vast
majority of its security fixes by **rebasing onto new ESR releases** rather than
by patching independently. In practice:

- **The large majority of security issues affecting Cthulhu are upstream Firefox
  issues**, not bugs in this fork. Cthulhu's own code is a chrome-level theme,
  a new-tab dashboard, and a handful of build patches.
- **Follow [Mozilla's Security Advisories](https://www.mozilla.org/security/advisories/)**
  for upstream issues. They are the authoritative source, they are published
  well before this fork rebases, and they describe the actual vulnerabilities.
- **There is a lag.** After Mozilla ships an ESR security release, Cthulhu
  remains on the older base until the rebase is done and a build is published.
  During that window Cthulhu is exposed to already-public upstream
  vulnerabilities. **This is the single most important security caveat of using
  this browser**, and it is inherent to a one-person fork.

Report upstream Firefox vulnerabilities to
[Mozilla](https://www.mozilla.org/about/governance/policies/security-group/bugs/),
not here — they can fix them at the source, and their process is designed for it.
Reports about **Cthulhu's own code** are very welcome here.

## Scope

**In scope** — anything in this repository: the chrome theme and its modules,
the `about:cthulhu` dashboard and its widgets, the Google Calendar integration
and its OAuth handling, the build patches under `src/`, and the default
preferences in `src/browser/app/profile/cthulhu.js`.

**Out of scope** — upstream Firefox/Gecko bugs (report to Mozilla), issues in
third-party extensions you install yourself, and anything requiring an attacker
to already have local access to your machine or profile.

## Things you should know

- **Builds are not notarized on macOS** and are currently ad-hoc signed. macOS
  Gatekeeper will warn. Only install builds you obtained from a source you trust.
- **There is no working auto-update pipeline yet.** Do not assume this browser
  will update itself; check for new releases manually. See PRIVACY.md for the
  current state of the update endpoint.
- Cthulhu removes telemetry and data collection. See **[PRIVACY.md](PRIVACY.md)**
  for exactly what it does and does not send.
