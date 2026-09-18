# Facet benchmarks

Every speed claim Facet makes traces back to a results file in `bench/results/`. This page is
generated from those files by `marketing/build-docs.mjs`.

## Machine

AMD Ryzen 5 7530U laptop, 14.8 GB RAM, NVMe SSD, Microsoft Windows 11. Power: mains. Electron 32 (Chromium 128). Windows Defender on, default settings.
No hostname or user data is recorded.

## Method

- The **packaged** build is measured (the `win-unpacked` folder the installer lays down), never
  `electron .`, driven over the DevTools protocol from `bench/run.mjs`. No timing code lives in
  the app.
- Both versions run on the same machine, the same generated data (`bench/gen-data.mjs`, seeded,
  never committed) and the same settings, back to back.
- Cold start = process spawn → the profile list is in the DOM. 5 runs after one discarded
  warm-up; median, with min–max kept in the JSON. This is a warm-disk cold start (the exe was run
  before), not first-run-after-reboot.
- Actions are timed inside the renderer with `performance.now()` around the same calls the UI
  makes, 10 runs (5 where a PowerShell lookup was involved).
- "Unlinked folders" are Claude data directories under `profiles\` that no profile claims.
  File counts (1k–15k) are calibrated on real Claude Desktop data dirs.
- Session stores are generated JSONL transcripts shaped like real ones (log-normal sizes, up to
  100 MB, tool results, subagents). "large" mirrors a real heavy-use store: 215 transcripts, ≈0.7 GB.
- Memory is the whole process tree's working set after 10 s idle; idle CPU is CPU time over a
  30 s window.

## Results — 0.1.2 → 0.2.0

### Cold start → profiles visible

| | 0.1.2 | 0.2.0 | |
|---|---:|---:|---|
| 1 profiles, 0 unlinked folders, Claude path known | 759 ms | 697 ms | 8% faster |
| 3 profiles, 1 unlinked folder × 1,000 files, Claude path known | 984 ms | 706 ms | 28% faster |
| 25 profiles, 3 unlinked folders × 5,000 files, Claude path known | 9.4 s | 692 ms | **14× faster** |
| 200 profiles, 5 unlinked folders × 15,000 files, Claude path known | 44 s | 683 ms | **64× faster** |
| 3 profiles, 1 unlinked folder × 1,000 files, Store install (auto-detect) | 2.7 s | 755 ms | **3.6× faster** |

### Panel actions (every action pays the `profiles:list` round trip)

| | 0.1.2 | 0.2.0 | |
|---|---:|---:|---|
| Round trip — 3 profiles, 1 unlinked folder × 1,000 files, Claude path known | 220 ms | 5 ms | **45× faster** |
| Rename ×2 — 3 profiles, 1 unlinked folder × 1,000 files, Claude path known | 447 ms | 30 ms | **15× faster** |
| Round trip — 3 profiles, 1 unlinked folder × 1,000 files, Store install (auto-detect) | 1.9 s | 8 ms | **251× faster** |
| Rename ×2 — 3 profiles, 1 unlinked folder × 1,000 files, Store install (auto-detect) | 3.8 s | 38 ms | **101× faster** |
| Round trip — 25 profiles, 3 unlinked folders × 5,000 files, Claude path known | 8.6 s | 6 ms | **1489× faster** |
| Rename ×2 — 25 profiles, 3 unlinked folders × 5,000 files, Claude path known | 17 s | 65 ms | **266× faster** |
| Round trip — 200 profiles, 5 unlinked folders × 15,000 files, Claude path known | 42 s | 9 ms | **4707× faster** |
| Rename ×2 — 200 profiles, 5 unlinked folders × 15,000 files, Claude path known | 101 s | 581 ms | **174× faster** |
| Recovery view: list unlinked folders — 25 profiles, 3 × 5,000 files | 8.6 s | 3 ms | **2764× faster** |

### Export-a-session view

| | 0.1.2 | 0.2.0 | |
|---|---:|---:|---|
| Open the list — 60 sessions | 494 ms | 374 ms | 24% faster |
| Filter, per keystroke — 60 sessions | 23 ms | 8 ms | **3.0× faster** |
| Open the list — 215 sessions | 1.4 s | 370 ms | **3.9× faster** |
| Filter, per keystroke — 215 sessions | 79 ms | 8 ms | **10× faster** |
| Open the list — 1000 sessions | 5.7 s | 643 ms | **8.8× faster** |
| Filter, per keystroke — 1000 sessions | 81 ms | 12 ms | **6.6× faster** |

The list is cached by path + size + mtime after the first open; the "open" rows are medians of 5
opens, so they reflect a warm cache (the first, uncached open of 215 sessions is about
2× faster than 0.1.2, not 4×).

### Export one session to zip

| | 0.1.2 | 0.2.0 | |
|---|---:|---:|---|
| 1KB transcript (1 turns) | 2.1 s | 344 ms | **6.1× faster** |
| 1MB transcript (10 turns) | 2.9 s | 514 ms | **5.6× faster** |
| 20MB transcript (115 turns) | 9.7 s | 2.2 s | **4.4× faster** |
| 50MB transcript (298 turns) | 20 s | 5.6 s | **3.6× faster** |
| 100MB transcript (566 turns) | 41 s | 11 s | **3.6× faster** |

Zip sizes are within 2% of 0.1.2 (28.43 → 28.12 MB for the 50 MB session). Contents are
byte-identical — see `bench/verify-export.mjs`.

### Footprint

| | 0.1.2 | 0.2.0 |
|---|---:|---:|
| Memory, idle, whole process tree (working set) | 340.3 MB | 333.2 MB |
| Memory, idle (private bytes) | 223.5 MB | 217.1 MB |
| CPU when idle (% of one core) | 0.1% | 0.11% |
| Installer | 76.35 MB | 76.36 MB |
| Installed on disk | 264.95 MB | 264.95 MB |
| App code (app.asar) | 163.5 KB | 163.5 KB |

Memory and size did not change: they are Electron's floor, not Facet's code.

## What got slower

- `suites.actions.xl/stub.openManageMs`: 168 ms → 250 ms — re-measured interleaved in one session (20 runs each): 0.1.2 median 237 ms, 0.2.0 median 187 ms. Run-to-run noise, not a regression.

## Caveats

- One machine, one OS build. Your numbers will differ; the ratios should not.
- The Microsoft Store detection saving only applies if Claude Desktop is the Store (MSIX) build.
  With the classic installer, 0.1.2 was already 220 ms per action on 3 profiles, not 1.9 s.
- Unlinked-folder costs scale with file count; a user with no leftover folders never paid them.
- "Profiles on screen" is when the DOM has the rows, not when pixels reach the display; the
  panel window is hidden while measuring, so paint is not included. Scrolling was not measured.
- Cold start medians differ by ±50 ms between runs of the same build depending on background load.
  Deltas that small are noise, not a change.
- The generated transcripts compress worse than real ones (random words), so real zips are smaller.
- Conditions per suite are recorded in each results file. 0.2.0 run: AC, 2.46 GB free RAM, 27.9% background CPU at cold start;
  0.1.2 run: AC, 2.73 GB free RAM, 14.7% background CPU.

## Reproduce

```
npm ci
npm run build                          # packaged build under dist/
node bench/gen-data.mjs                # ~3.7 GB of generated data under %LOCALAPPDATA%\facet-bench
node bench/run.mjs --label <version>   # full suite, ~15 min for 0.2.0, ~1 h for 0.1.2
node bench/report.mjs <new> --before <old>
```
