# X / Bluesky — short posts (pick one, image: race-1200x630.png)

1.
Facet 0.2.0: same laptop, same data, 251× faster per click.
The fix was deleting two things it did on every click: a 2 s PowerShell lookup and stat-ing 15,000 files to get a number nobody used.
Every number: bench/results in the repo, medians of 5 runs on a Ryzen 5 laptop.
https://github.com/viveksthul15/facet

2.
Exporting a 50 MB Claude session: 20 s → 5.6 s.
Compress-Archive was 92% of the time. Replaced with 400 lines of Node that deflate chunks in parallel. Archives byte-identical. No new deps.
https://github.com/viveksthul15/facet

3.
Profiling beats guessing. I assumed my tray app was slow because Electron. It was slow because it ran Get-AppxPackage on every click.
Facet 0.2.0 — numbers, not adjectives: https://github.com/viveksthul15/facet/blob/main/BENCHMARKS.md
