# Facet 0.1.2 — performance baseline

Machine: AMD Ryzen 5 7530U with Radeon Graphics, 12 threads, 14.8 GB RAM, SSD NVMe, Microsoft Windows 11 Home Single Language 10.0.26200. Electron null. Power: AC.

Timings are `median (min–max)`. Cold start: 5 runs after 1 discarded warm-up. Build: packaged win-unpacked, portable mode, driven over DevTools protocol.

## Cold start → profiles visible in the panel

| scenario | first content | of which: main process ready |
| --- | ---: | ---: |
| small — 1 profiles, 0×0 unlinked files, Claude path known | 759 ms (715 ms–998 ms) | 380 ms (338 ms–460 ms) |
| typical — 3 profiles, 1×1000 unlinked files, Claude path known | 984 ms (937 ms–1.23 s) | 356 ms (343 ms–357 ms) |
| large — 25 profiles, 3×5000 unlinked files, Claude path known | 9.37 s (9.28 s–10.17 s) | 343 ms (331 ms–359 ms) |
| xl — 200 profiles, 5×15000 unlinked files, Claude path known | 44.03 s (43.71 s–44.57 s) | 345 ms (331 ms–363 ms) |
| typical — 3 profiles, 1×1000 unlinked files, auto-detect (Store/MSIX probe) | 2.71 s (2.59 s–3.02 s) | 353 ms (331 ms–373 ms) |

## Panel actions

**small — 1 profiles, 0×0 unlinked files, Claude path known**

|  | 0.1.2 |
| --- | ---: |
| profiles:list round trip (paid by every action) | 7.6 ms (6.9 ms–71.2 ms) |
| refresh + re-render | 10.7 ms (8.7 ms–14.1 ms) |
| render profile list | 2.7 ms (2.4 ms–3.8 ms) |
| open Manage | 3.4 ms (2.5 ms–21 ms) |
| open Settings | 4.1 ms (3.2 ms–29.4 ms) |
| rename ×2 | 33.2 ms (29.7 ms–102 ms) |
| new-profile name check, per keystroke | 1.5 ms (1.2 ms–4.9 ms) |
| list unlinked folders (Recovery) | 1.8 ms (1.6 ms–2.3 ms) |

**typical — 3 profiles, 1×1000 unlinked files, Claude path known**

|  | 0.1.2 |
| --- | ---: |
| profiles:list round trip (paid by every action) | 220 ms (212 ms–249 ms) |
| refresh + re-render | 232 ms (218 ms–308 ms) |
| render profile list | 3.8 ms (3.3 ms–5 ms) |
| open Manage | 6.7 ms (4.2 ms–26.7 ms) |
| open Settings | 4.5 ms (3.4 ms–36 ms) |
| reorder ×2 | 495 ms (451 ms–673 ms) |
| rename ×2 | 447 ms (435 ms–454 ms) |
| new-profile name check, per keystroke | 1.5 ms (1.4 ms–2.2 ms) |
| list unlinked folders (Recovery) | 207 ms (203 ms–221 ms) |

**large — 25 profiles, 3×5000 unlinked files, Claude path known**

|  | 0.1.2 |
| --- | ---: |
| profiles:list round trip (paid by every action) | 8.63 s (8.38 s–8.98 s) |
| refresh + re-render | 8.68 s (8.21 s–9.27 s) |
| render profile list | 10.7 ms (8.4 ms–14.2 ms) |
| open Manage | 21.5 ms (19.3 ms–38.2 ms) |
| open Settings | 4.4 ms (3.2 ms–40.5 ms) |
| reorder ×2 | 17.28 s (16.58 s–17.42 s) |
| rename ×2 | 17.32 s (16.71 s–17.82 s) |
| new-profile name check, per keystroke | 1.5 ms (1.3 ms–5.4 ms) |
| list unlinked folders (Recovery) | 8.57 s (8.18 s–8.71 s) |

**xl — 200 profiles, 5×15000 unlinked files, Claude path known**

|  | 0.1.2 |
| --- | ---: |
| profiles:list round trip (paid by every action) | 41.89 s (41.29 s–42.40 s) |
| refresh + re-render | 42.03 s (41.57 s–43.58 s) |
| render profile list | 59.9 ms (53.1 ms–69.2 ms) |
| open Manage | 168 ms (146 ms–191 ms) |
| open Settings | 3.3 ms (2.8 ms–39.8 ms) |
| reorder ×2 | 88.73 s (84.49 s–99.72 s) |
| rename ×2 | 100.90 s (86.15 s–109.09 s) |
| new-profile name check, per keystroke | 2.3 ms (2.1 ms–5.6 ms) |
| list unlinked folders (Recovery) | 56.51 s (50.72 s–71.48 s) |

**typical — 3 profiles, 1×1000 unlinked files, auto-detect (Store/MSIX probe)**

|  | 0.1.2 |
| --- | ---: |
| profiles:list round trip (paid by every action) | 1.93 s (1.91 s–2.05 s) |
| refresh + re-render | 1.89 s (1.84 s–1.94 s) |
| render profile list | 3.2 ms (2.9 ms–4 ms) |
| open Manage | 5.7 ms (4.6 ms–16.2 ms) |
| open Settings | 4.2 ms (3.6 ms–34.8 ms) |
| reorder ×2 | 3.98 s (3.96 s–4.02 s) |
| rename ×2 | 3.80 s (3.79 s–3.89 s) |
| new-profile name check, per keystroke | 1.6 ms (1.4 ms–2.1 ms) |
| list unlinked folders (Recovery) | 611 ms (565 ms–647 ms) |

## Export-a-session view

**small — 3 sessions (3 generated)**

|  | 0.1.2 |
| --- | ---: |
| open view → list shown | 242 ms (233 ms–400 ms) |
| re-render list | 3.1 ms (2.5 ms–4.7 ms) |
| filter, per keystroke | 2.7 ms (1.4 ms–3.2 ms) |

**typical — 60 sessions (55 generated + export targets)**

|  | 0.1.2 |
| --- | ---: |
| open view → list shown | 494 ms (483 ms–729 ms) |
| re-render list | 26 ms (22.7 ms–36.7 ms) |
| filter, per keystroke | 23 ms (5.4 ms–26 ms) |

**large — 215 sessions (215 generated)**

|  | 0.1.2 |
| --- | ---: |
| open view → list shown | 1.45 s (1.42 s–1.91 s) |
| re-render list | 91.5 ms (77.3 ms–111 ms) |
| filter, per keystroke | 78.5 ms (19.1 ms–92.2 ms) |

**xl — 1000 sessions (1000 generated)**

|  | 0.1.2 |
| --- | ---: |
| open view → list shown | 5.66 s (5.52 s–8.06 s) |
| re-render list | 78.9 ms (68.2 ms–99.2 ms) |
| filter, per keystroke | 81.1 ms (26.7 ms–94.2 ms) |

## Export one session to zip (transcript size)

| transcript | export time | zip size | turns |
| --- | ---: | ---: | ---: |
| 1KB | 2.09 s (2.04 s–2.49 s) | 0 MB | 1 |
| 1MB | 2.87 s (2.82 s–2.98 s) | 0.76 MB | 10 |
| 20MB | 9.70 s (9.50 s–9.78 s) | 11.15 MB | 115 |
| 50MB | 20.35 s (20.26 s–20.98 s) | 28.43 MB | 298 |
| 100MB | 40.96 s (40.22 s–40.99 s) | 58.2 MB | 566 |

## Footprint

|  | 0.1.2 |
| --- | ---: |
| memory, idle, whole process tree (4 processes) — working set | 340.3 MB |
| memory, idle — private bytes | 223.5 MB |
| CPU when idle (% of one core, 30 s window) | 0.1 % |
| memory with 215-session list loaded — working set | 459 MB |
| installer | 76.35 MB |
| portable exe | 76.16 MB |
| installed on disk | 264.95 MB |
| app code (app.asar) | 163.5 KB |

## Conditions during the run

| suite | power | free RAM before → after | machine CPU load before → after |
| --- | ---: | ---: | ---: |
| cold | AC | 2.73 → 3.22 GB | 14.7% → 15.5% |
| actions | AC | 3.06 → 3.31 GB | 19.6% → 8.8% |
| sessions | AC | 3.29 → 3.19 GB | 5.7% → 20.3% |
| export | AC | 3.2 → 2.61 GB | 7.6% → 37.1% |
| memory | AC | 2.62 → 2.66 GB | 11.9% → 17.6% |
