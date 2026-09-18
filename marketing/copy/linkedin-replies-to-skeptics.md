# Replies for skeptical comments

**"251× is a cherry-picked number."**
Fair — it's the best case: Claude installed from the Microsoft Store, where the old version ran a 2-second PowerShell lookup on every click. With the classic installer the same click went from 220 ms to 5 ms. Both are in the results file, and the README table shows both.

**"Medians of 5 runs isn't a benchmark."**
It's 5 cold starts per scenario plus 10 timed runs per action, min–max kept in the JSON, both versions back to back on the same machine. It's enough to separate a 251× change from noise. Deltas under ~50 ms I call noise in BENCHMARKS.md.

**"Why was it that slow to begin with?"**
Because I wrote it in an afternoon and it felt fine on my machine with 3 profiles and no leftover folders. Slow paths hide behind small data. The benchmark generator makes the big data I didn't have.

**"Electron, 335 MB for a tray icon?"**
Yes. That number didn't change and I say so. If a native rewrite happens, this benchmark suite is what it will be judged against.

**"Did the export output change?"**
No. bench/verify-export.mjs extracts old and new archives and compares every file byte for byte, on 30 sessions with subagents, tool results, empty folders and unicode names. Plus 3,000 random transcripts for the metadata and readable transcript.

**"Faster than [other launcher]?"**
Didn't measure it, so I won't say. Only Facet 0.1.2 vs 0.2.0.
