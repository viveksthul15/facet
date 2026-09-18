# Facet 0.1.2 → 0.2.0: before / after

Machine: AMD Ryzen 5 7530U with Radeon Graphics, 12 threads, 14.8 GB RAM, SSD NVMe, Microsoft Windows 11 Home Single Language 10.0.26200. Electron null. Power: AC.

Timings are `median (min–max)`. Cold start: 5 runs after 1 discarded warm-up. Build: packaged win-unpacked, portable mode, driven over DevTools protocol.

## Cold start → profiles visible in the panel

| scenario | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| small — 1 profiles, 0×0 unlinked files, Claude path known | 759 ms (715 ms–998 ms) | 697 ms (668 ms–704 ms) | 8% faster |
| typical — 3 profiles, 1×1000 unlinked files, Claude path known | 984 ms (937 ms–1.23 s) | 706 ms (668 ms–713 ms) | 28% faster |
| large — 25 profiles, 3×5000 unlinked files, Claude path known | 9.37 s (9.28 s–10.17 s) | 692 ms (684 ms–802 ms) | **14× faster** |
| xl — 200 profiles, 5×15000 unlinked files, Claude path known | 44.03 s (43.71 s–44.57 s) | 683 ms (651 ms–753 ms) | **64× faster** |
| typical — 3 profiles, 1×1000 unlinked files, auto-detect (Store/MSIX probe) | 2.71 s (2.59 s–3.02 s) | 755 ms (719 ms–849 ms) | **3.6× faster** |

## Panel actions

**small — 1 profiles, 0×0 unlinked files, Claude path known**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| profiles:list round trip (paid by every action) | 7.6 ms (6.9 ms–71.2 ms) | 4.8 ms (3.9 ms–15.4 ms) | 37% faster |
| refresh + re-render | 10.7 ms (8.7 ms–14.1 ms) | 8 ms (7.1 ms–10.4 ms) | 25% faster |
| render profile list | 2.7 ms (2.4 ms–3.8 ms) | 3 ms (2.4 ms–3.6 ms) | ⚠ 11% slower |
| open Manage | 3.4 ms (2.5 ms–21 ms) | 3 ms (2.4 ms–17.2 ms) | 12% faster |
| open Settings | 4.1 ms (3.2 ms–29.4 ms) | 4.3 ms (3.1 ms–39 ms) | same |
| rename ×2 | 33.2 ms (29.7 ms–102 ms) | 31.2 ms (27.4 ms–52.2 ms) | 6% faster |
| new-profile name check, per keystroke | 1.5 ms (1.2 ms–4.9 ms) | 1.4 ms (1.3 ms–2 ms) | 7% faster |
| list unlinked folders (Recovery) | 1.8 ms (1.6 ms–2.3 ms) | 1.5 ms (1.4 ms–1.7 ms) | 17% faster |

**typical — 3 profiles, 1×1000 unlinked files, Claude path known**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| profiles:list round trip (paid by every action) | 220 ms (212 ms–249 ms) | 4.9 ms (4.3 ms–76.4 ms) | **45× faster** |
| refresh + re-render | 232 ms (218 ms–308 ms) | 9.8 ms (8.2 ms–12.9 ms) | **24× faster** |
| render profile list | 3.8 ms (3.3 ms–5 ms) | 4.3 ms (3.5 ms–5.7 ms) | ⚠ 13% slower |
| open Manage | 6.7 ms (4.2 ms–26.7 ms) | 4.8 ms (3.9 ms–18.4 ms) | 28% faster |
| open Settings | 4.5 ms (3.4 ms–36 ms) | 3.8 ms (3.2 ms–30.6 ms) | 16% faster |
| reorder ×2 | 495 ms (451 ms–673 ms) | 28.2 ms (26.7 ms–32.9 ms) | **18× faster** |
| rename ×2 | 447 ms (435 ms–454 ms) | 29.9 ms (28.4 ms–31.5 ms) | **15× faster** |
| new-profile name check, per keystroke | 1.5 ms (1.4 ms–2.2 ms) | 1.5 ms (1.3 ms–2.2 ms) | same |
| list unlinked folders (Recovery) | 207 ms (203 ms–221 ms) | 2.1 ms (1.9 ms–2.7 ms) | **98× faster** |

**large — 25 profiles, 3×5000 unlinked files, Claude path known**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| profiles:list round trip (paid by every action) | 8.63 s (8.38 s–8.98 s) | 5.8 ms (4.4 ms–89 ms) | **1489× faster** |
| refresh + re-render | 8.68 s (8.21 s–9.27 s) | 17.2 ms (14.9 ms–55.6 ms) | **505× faster** |
| render profile list | 10.7 ms (8.4 ms–14.2 ms) | 12.8 ms (10.1 ms–20.1 ms) | ⚠ 20% slower |
| open Manage | 21.5 ms (19.3 ms–38.2 ms) | 19.3 ms (17.5 ms–53.8 ms) | 10% faster |
| open Settings | 4.4 ms (3.2 ms–40.5 ms) | 3.1 ms (2.9 ms–28 ms) | 30% faster |
| reorder ×2 | 17.28 s (16.58 s–17.42 s) | 47.1 ms (46.2 ms–69.6 ms) | **367× faster** |
| rename ×2 | 17.32 s (16.71 s–17.82 s) | 65 ms (58.2 ms–158 ms) | **266× faster** |
| new-profile name check, per keystroke | 1.5 ms (1.3 ms–5.4 ms) | 1.5 ms (1.4 ms–2.2 ms) | same |
| list unlinked folders (Recovery) | 8.57 s (8.18 s–8.71 s) | 3.1 ms (2.9 ms–34.5 ms) | **2764× faster** |

**xl — 200 profiles, 5×15000 unlinked files, Claude path known**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| profiles:list round trip (paid by every action) | 41.89 s (41.29 s–42.40 s) | 8.9 ms (6.4 ms–139 ms) | **4707× faster** |
| refresh + re-render | 42.03 s (41.57 s–43.58 s) | 74.9 ms (63.1 ms–105 ms) | **561× faster** |
| render profile list | 59.9 ms (53.1 ms–69.2 ms) | 55.6 ms (49 ms–57.6 ms) | 7% faster |
| open Manage | 168 ms (146 ms–191 ms) | 250 ms (139 ms–283 ms) | ⚠ 48% slower |
| open Settings | 3.3 ms (2.8 ms–39.8 ms) | 4.5 ms (3 ms–59.2 ms) | ⚠ 36% slower |
| reorder ×2 | 88.73 s (84.49 s–99.72 s) | 376 ms (318 ms–622 ms) | **236× faster** |
| rename ×2 | 100.90 s (86.15 s–109.09 s) | 581 ms (503 ms–776 ms) | **174× faster** |
| new-profile name check, per keystroke | 2.3 ms (2.1 ms–5.6 ms) | 5.5 ms (5.3 ms–9 ms) | ⚠ 139% slower |
| list unlinked folders (Recovery) | 56.51 s (50.72 s–71.48 s) | 7.3 ms (5.4 ms–36.7 ms) | **7741× faster** |

**typical — 3 profiles, 1×1000 unlinked files, auto-detect (Store/MSIX probe)**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| profiles:list round trip (paid by every action) | 1.93 s (1.91 s–2.05 s) | 7.7 ms (6.7 ms–17.9 ms) | **251× faster** |
| refresh + re-render | 1.89 s (1.84 s–1.94 s) | 14.3 ms (12.6 ms–14.6 ms) | **132× faster** |
| render profile list | 3.2 ms (2.9 ms–4 ms) | 6.3 ms (5.9 ms–6.8 ms) | ⚠ 97% slower |
| open Manage | 5.7 ms (4.6 ms–16.2 ms) | 7 ms (5.3 ms–23.1 ms) | ⚠ 23% slower |
| open Settings | 4.2 ms (3.6 ms–34.8 ms) | 5.4 ms (4.5 ms–46.5 ms) | ⚠ 29% slower |
| reorder ×2 | 3.98 s (3.96 s–4.02 s) | 41 ms (38.4 ms–241 ms) | **97× faster** |
| rename ×2 | 3.80 s (3.79 s–3.89 s) | 37.6 ms (36.4 ms–39.7 ms) | **101× faster** |
| new-profile name check, per keystroke | 1.6 ms (1.4 ms–2.1 ms) | 2.1 ms (1.7 ms–2.5 ms) | ⚠ 31% slower |
| list unlinked folders (Recovery) | 611 ms (565 ms–647 ms) | 2.5 ms (2.3 ms–3.1 ms) | **245× faster** |

## Export-a-session view

**small — 3 sessions (3 generated)**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| open view → list shown | 242 ms (233 ms–400 ms) | 222 ms (218 ms–300 ms) | 8% faster |
| re-render list | 3.1 ms (2.5 ms–4.7 ms) | 1.7 ms (1.6 ms–2 ms) | 45% faster |
| filter, per keystroke | 2.7 ms (1.4 ms–3.2 ms) | 1.7 ms (1.5 ms–1.8 ms) | 37% faster |

**typical — 60 sessions (55 generated + export targets)**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| open view → list shown | 494 ms (483 ms–729 ms) | 374 ms (268 ms–516 ms) | 24% faster |
| re-render list | 26 ms (22.7 ms–36.7 ms) | 14.1 ms (9.9 ms–15.5 ms) | 46% faster |
| filter, per keystroke | 23 ms (5.4 ms–26 ms) | 7.6 ms (3 ms–11.3 ms) | **3.0× faster** |

**large — 215 sessions (215 generated)**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| open view → list shown | 1.45 s (1.42 s–1.91 s) | 370 ms (339 ms–1.12 s) | **3.9× faster** |
| re-render list | 91.5 ms (77.3 ms–111 ms) | 7.9 ms (7.5 ms–10.6 ms) | **12× faster** |
| filter, per keystroke | 78.5 ms (19.1 ms–92.2 ms) | 7.8 ms (6.2 ms–9.4 ms) | **10× faster** |

**xl — 1000 sessions (1000 generated)**

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| open view → list shown | 5.66 s (5.52 s–8.06 s) | 643 ms (596 ms–4.03 s) | **8.8× faster** |
| re-render list | 78.9 ms (68.2 ms–99.2 ms) | 12 ms (11 ms–14.6 ms) | **6.6× faster** |
| filter, per keystroke | 81.1 ms (26.7 ms–94.2 ms) | 12.3 ms (9.2 ms–14.2 ms) | **6.6× faster** |

## Export one session to zip (transcript size)

| transcript | 0.1.2 | 0.2.0 | change | zip |
| --- | ---: | ---: | ---: | ---: |
| 1KB | 2.09 s (2.04 s–2.49 s) | 344 ms (288 ms–476 ms) | **6.1× faster** | 0 → 0 MB |
| 1MB | 2.87 s (2.82 s–2.98 s) | 514 ms (509 ms–553 ms) | **5.6× faster** | 0.76 → 0.75 MB |
| 20MB | 9.70 s (9.50 s–9.78 s) | 2.19 s (2.18 s–2.27 s) | **4.4× faster** | 11.15 → 11.02 MB |
| 50MB | 20.35 s (20.26 s–20.98 s) | 5.64 s (5.57 s–5.65 s) | **3.6× faster** | 28.43 → 28.12 MB |
| 100MB | 40.96 s (40.22 s–40.99 s) | 11.41 s (11.11 s–12.49 s) | **3.6× faster** | 58.2 → 57.6 MB |

## Footprint

|  | 0.1.2 | 0.2.0 | change |
| --- | ---: | ---: | ---: |
| memory, idle, whole process tree (4 processes) — working set | 340.3 MB | 333.2 MB | same |
| memory, idle — private bytes | 223.5 MB | 217.1 MB | same |
| CPU when idle (% of one core, 30 s window) | 0.1 % | 0.11 % | ⚠ 10% bigger |
| memory with 215-session list loaded — working set | 459 MB | 405.5 MB | 12% smaller |
| installer | 76.35 MB | 76.36 MB | same |
| portable exe | 76.16 MB | 76.16 MB | same |
| installed on disk | 264.95 MB | 264.95 MB | same |
| app code (app.asar) | 163.5 KB | 163.5 KB | same |

## Conditions during the run

| suite | power | free RAM before → after | machine CPU load before → after |
| --- | ---: | ---: | ---: |
| cold | AC | 2.46 → 2.48 GB | 27.9% → 30.5% |
| actions | AC | 2.48 → 2.2 GB | 26.1% → 29.6% |
| sessions | AC | 2.68 → 2.32 GB | 15.5% → 24.6% |
| export | AC | 2.35 → 2.28 GB | 6.6% → 19.2% |
| memory | AC | 2.31 → 2.28 GB | 30.6% → 9.8% |

Baseline (0.1.2) conditions:

| suite | power | free RAM before → after | machine CPU load before → after |
| --- | ---: | ---: | ---: |
| cold | AC | 2.73 → 3.22 GB | 14.7% → 15.5% |
| actions | AC | 3.06 → 3.31 GB | 19.6% → 8.8% |
| sessions | AC | 3.29 → 3.19 GB | 5.7% → 20.3% |
| export | AC | 3.2 → 2.61 GB | 7.6% → 37.1% |
| memory | AC | 2.62 → 2.66 GB | 11.9% → 17.6% |
