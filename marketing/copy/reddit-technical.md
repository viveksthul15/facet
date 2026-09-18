# Reddit (r/electronjs or r/programming) — technical post

**Title:** Made an Electron tray app 251× faster per click by removing two things it did on every refresh — with a reproducible benchmark suite

Facet is a small Windows tray launcher that runs Claude Desktop with a separate `--user-data-dir` per account. I finally benchmarked it properly before/after and wanted to share both the fixes and the harness, because the harness was the interesting part.

**Harness** (in the repo, `bench/`):
- Measures the *packaged* build, driven over the DevTools protocol (`--remote-debugging-port` for the renderer, `--inspect` for main). No timing code in the app.
- Seeded data generator: profile stores with 1–200 profiles and leftover data folders of 1k–15k files; session stores of 3–1000 JSONL transcripts up to 100 MB.
- Cold start = spawn → rows in DOM, 5 runs + warm-up, min/max kept. Actions timed in-renderer around the real IPC calls.
- Process-tree memory, idle CPU, installer sizes. Machine specs and free RAM recorded, no hostnames.

**What the profile said** (V8 CPU profile of the main process, line-level):
- 88% of `profiles:list` was `fs.statSync` inside a folder-size walk over leftover data folders. The list only used the folder *count*.
- On Store (MSIX) installs of Claude, every refresh ran `Get-AppxPackage` via PowerShell synchronously: ~1.8 s, main process blocked.
- Export: 92% of wall time was `spawnSync` waiting on `Compress-Archive`.
- Session list: JSON.parse of the first 512 KB + last 256 KB of every transcript, every open.
- Filter keystroke: full panel rebuild, 200 rows of DOM + layout per key (Chromium trace: 78 ms script, 55 ms layout).

**Fixes:**
- Count folders on refresh; size them asynchronously and only in the Recovery view.
- Remember the Store path on disk; trust it while the exe exists; re-probe in the background.
- In-process zip writer (zlib deflateRaw, 4 MB chunks compressed in parallel with Z_SYNC_FLUSH boundaries — the pigz trick — then concatenated; zip64 when needed). Transcript deflated once and stored under both names. Single pass over the transcript for metadata + readable copy.
- List cache keyed by path+size+mtime; for uncached files, locate lines as byte ranges and only parse the ones that can matter.
- Re-render only the list on keystroke, 60 rows first, more on scroll, `content-visibility: auto`.

**Proof nothing changed:** old and new export functions compared on 3,000 random/hostile transcripts (bad JSON, CRLF, BOM, unicode, keywords hidden in strings) and 30 full archives extracted by Windows and diffed byte-for-byte. Also found that the old tool crashed on a bare `null` JSON line.

**Numbers** (medians, a Ryzen 5 laptop, same data both versions):

| | 0.1.2 | 0.2.0 |
|---|---:|---:|
| Every click in the panel (Claude Desktop from the Microsoft Store, 3 profiles) | 1.9 s | 8 ms |
| Start → profiles on screen (25 profiles, 3 old data folders) | 9.4 s | 692 ms |
| Export a 50 MB session to zip (298 turns, subagents + tool results) | 20 s | 5.6 s |
| Open the session list (215 transcripts, 735 MB) | 1.4 s | 370 ms |
| Filter the list, per keystroke (215 sessions) | 79 ms | 8 ms |
| Rename a profile (Store install, 3 profiles (two renames)) | 3.8 s | 38 ms |

Memory didn't change (340.3 → 333.2 MB idle) — Electron floor.

Full method + caveats: https://github.com/viveksthul15/facet/blob/main/BENCHMARKS.md
Repo: https://github.com/viveksthul15/facet
