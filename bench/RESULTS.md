# Baseline benchmark results

Footprint measurements taken around the Phase 1 debloat work, using
[`measure.sh`](measure.sh) in this directory.

## Method

Both runs used an identical workload on the same machine (Apple Silicon, macOS),
each against a throwaway profile created fresh for the run:

- **5 tabs** — `example.com`, `wikipedia.org`, `github.com`, a YouTube video, `about:blank`
- **30 s settle** after launch before sampling
- Totals summed across every browser process via `ps -o rss=` and `ps -o %cpu=`

## Results

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Process count | 17 | 16 | −1 |
| Total RSS | 2011.9 MB | 2007.3 MB | −4.6 MB (−0.2 %) |
| Parent-process RSS | 626.5 MB | 636.4 MB | +9.9 MB |
| Aggregate CPU | 1.5 % | 2.1 % | +0.6 pp |

Runs: **before** 2026-07-27 23:30 PDT, **after** 2026-07-28 09:11 PDT.

## How to read these numbers

**These deltas are run-to-run noise, not a demonstrated improvement.** Total RSS
moved by 0.2 %, and the parent process and aggregate CPU both went slightly *up*.

The YouTube tab is the main reason: media decode keeps CPU and RSS from settling
to a true idle, so the aggregate CPU figure in particular varies noticeably
between runs of the same build.

What this pair does establish is that the debloat changes did **not regress**
footprint — the workload is identical across both runs and the totals are
effectively unchanged. Treat it as a regression guard, not as evidence of a win.
