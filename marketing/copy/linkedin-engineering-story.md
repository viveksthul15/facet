# LinkedIn — engineering story post

Image: marketing/out/tiles-1200x630.png

I made my little Windows tray app 251× faster on one click, and the fix was deleting work, not adding cleverness.

Facet launches Claude Desktop with one data folder per account. The panel is a list of profiles. It should be instant. It wasn't.

**The problem.** Every click — rename, reorder, even opening Settings — refreshed the profile list. That refresh did two things it had no business doing every time:
1. It asked PowerShell where the Microsoft Store build of Claude lives. Get-AppxPackage takes ~2 seconds. On every click.
2. It measured the size of every leftover Claude data folder by stat-ing every file inside. A Claude data dir has 1,000–15,000 files. The list only needed the *count*.

**The surprise.** I only found #1 because I benchmarked on my own laptop, which has the Store build. With the classic installer the probe never runs, and I'd have shipped it again. Benchmark the configurations your users actually have.

**The numbers** (medians of 5, a Ryzen 5 laptop, packaged build, same data both versions):
- Every click, Store install: 1.9 s → 8 ms (251×)
- Start → profiles on screen, 25 profiles: 9.4 s → 692 ms (14×)
- Export a 50 MB session to zip: 20 s → 5.6 s (3.6×) — Compress-Archive replaced by an in-process zip writer, chunks deflated in parallel
- Session list, 215 transcripts: 1.4 s → 370 ms; each filter keystroke 79 ms → 8 ms

**The lesson.** Cache the answer that doesn't change, count instead of measure, and never shell out on a hot path. None of this needed a new dependency; the export zip is 400 lines of Node and the archives are byte-identical to before (checked on 3,000 random transcripts).

Memory didn't move (333.2 MB idle — that's Electron's floor, not mine). I'm not claiming otherwise.

Method, raw JSON and caveats: https://github.com/viveksthul15/facet/blob/main/BENCHMARKS.md

#electron #performance #windows #opensource
