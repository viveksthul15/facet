# Hacker News — Show HN

**Title:** Show HN: Facet 0.2.0 – Windows tray launcher for multiple Claude Desktop accounts, now with a public benchmark suite

**Text:**
Facet runs Claude Desktop with one data folder per account from a tray icon. 0.2.0 is a performance release: I built a benchmark harness that drives the packaged app over the DevTools protocol on generated data, profiled it, and removed the work it repeated on every click (a synchronous PowerShell lookup for Store installs, and a stat walk over thousands of files to compute a size nobody read).

Per click: 1.9 s → 8 ms on a Store install. Cold start with 25 profiles: 9.4 s → 692 ms. Exporting a 50 MB session: 20 s → 5.6 s (in-process zip writer replacing Compress-Archive; archives byte-identical, verified on 3,000 random transcripts).

Only compared against my own previous version, on a Ryzen 5 laptop. Memory is unchanged and I say so. Method, raw JSON and caveats are in BENCHMARKS.md; the harness is in bench/ so you can rerun it.

https://github.com/viveksthul15/facet

---

# Product Hunt

**Tagline:** One identity, many facets — Claude Desktop, one profile per account

**Description:**
Facet is a tiny, open-source Windows tray launcher that opens Claude Desktop on the right account every time — work, personal, client — each in its own data directory. No token handling, no network, no telemetry.

0.2.0 is the speed release: every click in the panel is 8 ms instead of 1.9 s on Store installs, the app shows your profiles in 692 ms instead of 9.4 s with 25 of them, and exporting a 50 MB Claude Code session takes 5.6 s instead of 20 s. Every number comes from a benchmark suite that ships in the repo.

**First comment (maker):**
Numbers are medians of 5 runs on a Ryzen 5 laptop, packaged build, same data for both versions, compared only against Facet 0.1.2. What did *not* improve: memory (~333.2 MB idle, Electron's floor). Details and caveats: https://github.com/viveksthul15/facet/blob/main/BENCHMARKS.md
