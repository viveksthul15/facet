# Launch plan — Facet 0.2.0

## Claim rules

**Do claim**
- Any number in `marketing/speed-data.json`, with its scenario ("on a Store install, 3 profiles") and machine ("on a Ryzen 5 laptop").
- "N× faster" only when the ratio is ≥ 2; otherwise "N% faster". Ratios come from medians.
- "Byte-identical archives" — backed by bench/verify-export.mjs.
- "No new dependencies" — package.json devDependencies unchanged; runtime has none.

**Don't claim**
- Anything vs. another product. Nothing else was benchmarked.
- "Instant", "blazing", "zero overhead" — adjectives without a number.
- Memory or install-size improvements — there are none (Electron floor). Say so if asked.
- The 251× figure without the Store-install qualifier. Classic-installer users saw 45× (220 ms → 5 ms).
- Cold-start improvements for users with 1 profile and no leftover folders — it's the same within noise.
- First-open session-list speed beyond ~2× — the 3.9× is with the cache warm.

## Sequence

1. Push README speed section, BENCHMARKS.md, marketing/out images to main (links must resolve before the release goes up).
2. Tag v0.2.0, create the GitHub release with the speed table, race image, SHA-256 checksums, SmartScreen note.
3. Smoke-test both downloaded exes from the release page on a clean profile.
4. Day 0: X/Bluesky post 1 + LinkedIn engineering story.
5. Day 1: Reddit technical post (r/electronjs), answer with the skeptic replies.
6. Day 2–3: Show HN in the morning US time; Product Hunt only if HN reception is warm.
7. Add the speed slide to the LinkedIn carousel; repost the carousel a week later.

## Assets

- marketing/out/race-1200x630.png — link previews, X, HN
- marketing/out/tiles-1200x630.png — LinkedIn story post
- marketing/out/race-1080x1350.png, tiles-1080x1350.png — LinkedIn carousel / Instagram
- marketing/out/receipt-1080x1080.png — fun square for X/Bluesky follow-up
