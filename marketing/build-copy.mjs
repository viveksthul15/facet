#!/usr/bin/env node
// Social / launch copy, generated from speed-data.json so every number in it is a measurement.
//   node marketing/build-copy.mjs   ->  marketing/copy/*.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'speed-data.json'), 'utf8'));
const OUT = path.join(HERE, 'copy');
fs.mkdirSync(OUT, { recursive: true });

const r = Object.fromEntries(S.rows.map((x) => [x.key, x]));
const X = (row) => (row.x >= 10 ? `${Math.round(row.x)}×` : `${row.x.toFixed(1)}×`);
const OLD = S.oldVersion, NEW = S.newVersion, M = S.machineShort;
const REPO = 'https://github.com/viveksthul15/facet';
const BENCH = `${REPO}/blob/main/BENCHMARKS.md`;
const trace = `Every number: bench/results in the repo, medians of 5 runs on ${M}.`;

const files = {
  'linkedin-carousel-speed-slide.md': `# LinkedIn carousel — speed slide (add as slide 4 of the existing Facet carousel)

Image: marketing/out/race-1080x1350.png (or tiles-1080x1350.png)

**Slide title:** Same laptop. Same data. Just faster.

**Body (max 3 lines on the slide):**
- Every click in the panel: ${r.click.oldText} → ${r.click.newText}
- Start → profiles on screen: ${r.cold.oldText} → ${r.cold.newText}
- Export a 50 MB session: ${r.export.oldText} → ${r.export.newText}

**Footer:** Facet ${OLD} → ${NEW} · ${M} · numbers in the repo
`,

  'linkedin-engineering-story.md': `# LinkedIn — engineering story post

Image: marketing/out/tiles-1200x630.png

I made my little Windows tray app ${X(r.click)} faster on one click, and the fix was deleting work, not adding cleverness.

Facet launches Claude Desktop with one data folder per account. The panel is a list of profiles. It should be instant. It wasn't.

**The problem.** Every click — rename, reorder, even opening Settings — refreshed the profile list. That refresh did two things it had no business doing every time:
1. It asked PowerShell where the Microsoft Store build of Claude lives. Get-AppxPackage takes ~2 seconds. On every click.
2. It measured the size of every leftover Claude data folder by stat-ing every file inside. A Claude data dir has 1,000–15,000 files. The list only needed the *count*.

**The surprise.** I only found #1 because I benchmarked on my own laptop, which has the Store build. With the classic installer the probe never runs, and I'd have shipped it again. Benchmark the configurations your users actually have.

**The numbers** (medians of 5, ${M}, packaged build, same data both versions):
- Every click, Store install: ${r.click.oldText} → ${r.click.newText} (${X(r.click)})
- Start → profiles on screen, 25 profiles: ${r.cold.oldText} → ${r.cold.newText} (${X(r.cold)})
- Export a 50 MB session to zip: ${r.export.oldText} → ${r.export.newText} (${X(r.export)}) — Compress-Archive replaced by an in-process zip writer, chunks deflated in parallel
- Session list, 215 transcripts: ${r.list.oldText} → ${r.list.newText}; each filter keystroke ${r.filter.oldText} → ${r.filter.newText}

**The lesson.** Cache the answer that doesn't change, count instead of measure, and never shell out on a hot path. None of this needed a new dependency; the export zip is 400 lines of Node and the archives are byte-identical to before (checked on 3,000 random transcripts).

Memory didn't move (${S.footprint.idleMemoryMB.new} MB idle — that's Electron's floor, not mine). I'm not claiming otherwise.

Method, raw JSON and caveats: ${BENCH}

#electron #performance #windows #opensource
`,

  'linkedin-replies-to-skeptics.md': `# Replies for skeptical comments

**"${X(r.click)} is a cherry-picked number."**
Fair — it's the best case: Claude installed from the Microsoft Store, where the old version ran a 2-second PowerShell lookup on every click. With the classic installer the same click went from ${Math.round(S.classicClick.old)} ms to ${Math.round(S.classicClick.new)} ms. Both are in the results file, and the README table shows both.

**"Medians of 5 runs isn't a benchmark."**
It's 5 cold starts per scenario plus 10 timed runs per action, min–max kept in the JSON, both versions back to back on the same machine. It's enough to separate a ${X(r.click)} change from noise. Deltas under ~50 ms I call noise in BENCHMARKS.md.

**"Why was it that slow to begin with?"**
Because I wrote it in an afternoon and it felt fine on my machine with 3 profiles and no leftover folders. Slow paths hide behind small data. The benchmark generator makes the big data I didn't have.

**"Electron, 335 MB for a tray icon?"**
Yes. That number didn't change and I say so. If a native rewrite happens, this benchmark suite is what it will be judged against.

**"Did the export output change?"**
No. bench/verify-export.mjs extracts old and new archives and compares every file byte for byte, on 30 sessions with subagents, tool results, empty folders and unicode names. Plus 3,000 random transcripts for the metadata and readable transcript.

**"Faster than [other launcher]?"**
Didn't measure it, so I won't say. Only Facet ${OLD} vs ${NEW}.
`,

  'x-bluesky.md': `# X / Bluesky — short posts (pick one, image: race-1200x630.png)

1.
Facet ${NEW}: same laptop, same data, ${X(r.click)} faster per click.
The fix was deleting two things it did on every click: a 2 s PowerShell lookup and stat-ing 15,000 files to get a number nobody used.
${trace}
${REPO}

2.
Exporting a 50 MB Claude session: ${r.export.oldText} → ${r.export.newText}.
Compress-Archive was 92% of the time. Replaced with 400 lines of Node that deflate chunks in parallel. Archives byte-identical. No new deps.
${REPO}

3.
Profiling beats guessing. I assumed my tray app was slow because Electron. It was slow because it ran Get-AppxPackage on every click.
Facet ${NEW} — numbers, not adjectives: ${BENCH}
`,

  'reddit-claudeai-launch.md': `# Reddit r/ClaudeAI — launch post

**Title:** I got tired of signing out of Claude Desktop to switch accounts, so I built a tray app that runs them side by side

Claude Desktop holds one account at a time. I have a work one and a personal one, and switching meant signing out, signing in, waiting, and losing whatever I had open. Every time.

Facet is a small Windows tray app that fixes it. Each profile launches Claude Desktop against its own data directory, so every account keeps its own session. Click a profile and the right Claude opens. Sign in once per account and that is the end of it.

The whole mechanism is one flag:

    Claude.exe --user-data-dir="%LOCALAPPDATA%\\Facet\\profiles\\claude-work"

Claude Desktop is Electron, and Electron honours that flag. Facet chooses a directory and starts a process — it never reads, copies or writes your session material, and it contains no network code at all.

What it does beyond that:
- **Adopt** the account you are already signed into as a profile, without signing out
- **Alt+1…9** launches a profile; a global hotkey opens the panel
- **Export a Claude Code session** to a zip — the archive /export used to write, rebuilt, since that command is gone from the desktop app
- Portable mode for a USB stick, and a policy file if you are deploying it

Free, MIT, no telemetry, no account, no update checks: ${REPO}

Two honest notes. It is unofficial and not affiliated with Anthropic — it launches the Claude Desktop you already have. And running multiple accounts may be subject to your plan's terms, so check them, especially on Team or Enterprise.

Windows only for now. It is Electron itself, so it costs about ${S.footprint.idleMemoryMB.new} MB sitting in the tray; I would rather say that than pretend otherwise.

Happy to answer anything about how it works.
`,

  'showhn-launch.md': `# Show HN — launch post (blocked while the HN account has no karma; see POSTING-TRACKER)

**Title:** Show HN: Facet – run several Claude Desktop accounts side by side on Windows

**Text:**
Claude Desktop stores one signed-in account. I kept signing out of work to check personal and back again, so I wrote a tray launcher that starts it with a per-profile data directory:

    Claude.exe --user-data-dir=%LOCALAPPDATA%\\Facet\\profiles\\claude-work

That one flag is the whole mechanism — Claude Desktop is Electron and honours it. Facet picks a directory and spawns a process. It never touches your tokens and makes no network calls of any kind: no analytics, no update check.

The parts that turned out more interesting than the idea:

- **The Microsoft Store build moves on every update.** Its install folder carries the version number, so a path cached at startup is dead by the afternoon. The launch then failed with an async ENOENT nobody was listening for: the click did nothing, and the profile kept showing a green "running" dot. Now the path is re-checked per launch, and a profile is only marked running once the process exists.
- **A window created with resizable:false keeps its current size as its minimum on Windows.** The panel could grow and never shrink, so after opening a tall view it ran past the bottom of the screen and cut off whatever sat at its foot.
- **Deep links cannot be routed to the right account.** claude:// has one handler, it names no profile, and a Store app claims the protocol by package identity — which outranks anything another program registers. Only the user can override that, in Windows Settings, by design.
- **Benchmarking the packaged build rather than the dev one found the real cost.** A click spent ${r.click.oldText} on this machine: a synchronous PowerShell lookup for where Claude lives, plus stat-ing thousands of files to compute a folder size nobody displayed. It is ${r.click.newText} now (${M}); method and raw JSON are in the repo.

MIT, no runtime dependencies, about 3.5k lines: ${REPO}

Unofficial, not affiliated with Anthropic. Windows only — the same trick works on macOS, but I have not built it.
`,

  'reddit-technical.md': `# Reddit (r/electronjs or r/programming) — technical post

**Title:** Made an Electron tray app ${X(r.click)} faster per click by removing two things it did on every refresh — with a reproducible benchmark suite

Facet is a small Windows tray launcher that runs Claude Desktop with a separate \`--user-data-dir\` per account. I finally benchmarked it properly before/after and wanted to share both the fixes and the harness, because the harness was the interesting part.

**Harness** (in the repo, \`bench/\`):
- Measures the *packaged* build, driven over the DevTools protocol (\`--remote-debugging-port\` for the renderer, \`--inspect\` for main). No timing code in the app.
- Seeded data generator: profile stores with 1–200 profiles and leftover data folders of 1k–15k files; session stores of 3–1000 JSONL transcripts up to 100 MB.
- Cold start = spawn → rows in DOM, 5 runs + warm-up, min/max kept. Actions timed in-renderer around the real IPC calls.
- Process-tree memory, idle CPU, installer sizes. Machine specs and free RAM recorded, no hostnames.

**What the profile said** (V8 CPU profile of the main process, line-level):
- 88% of \`profiles:list\` was \`fs.statSync\` inside a folder-size walk over leftover data folders. The list only used the folder *count*.
- On Store (MSIX) installs of Claude, every refresh ran \`Get-AppxPackage\` via PowerShell synchronously: ~1.8 s, main process blocked.
- Export: 92% of wall time was \`spawnSync\` waiting on \`Compress-Archive\`.
- Session list: JSON.parse of the first 512 KB + last 256 KB of every transcript, every open.
- Filter keystroke: full panel rebuild, 200 rows of DOM + layout per key (Chromium trace: 78 ms script, 55 ms layout).

**Fixes:**
- Count folders on refresh; size them asynchronously and only in the Recovery view.
- Remember the Store path on disk; trust it while the exe exists; re-probe in the background.
- In-process zip writer (zlib deflateRaw, 4 MB chunks compressed in parallel with Z_SYNC_FLUSH boundaries — the pigz trick — then concatenated; zip64 when needed). Transcript deflated once and stored under both names. Single pass over the transcript for metadata + readable copy.
- List cache keyed by path+size+mtime; for uncached files, locate lines as byte ranges and only parse the ones that can matter.
- Re-render only the list on keystroke, 60 rows first, more on scroll, \`content-visibility: auto\`.

**Proof nothing changed:** old and new export functions compared on 3,000 random/hostile transcripts (bad JSON, CRLF, BOM, unicode, keywords hidden in strings) and 30 full archives extracted by Windows and diffed byte-for-byte. Also found that the old tool crashed on a bare \`null\` JSON line.

**Numbers** (medians, ${M}, same data both versions):

| | ${OLD} | ${NEW} |
|---|---:|---:|
${S.rows.map((x) => `| ${x.label} (${x.sub}) | ${x.oldText} | ${x.newText} |`).join('\n')}

Memory didn't change (${S.footprint.idleMemoryMB.old} → ${S.footprint.idleMemoryMB.new} MB idle) — Electron floor.

Full method + caveats: ${BENCH}
Repo: ${REPO}
`,

  'hn-producthunt.md': `# Hacker News — Show HN

**Title:** Show HN: Facet ${NEW} – Windows tray launcher for multiple Claude Desktop accounts, now with a public benchmark suite

**Text:**
Facet runs Claude Desktop with one data folder per account from a tray icon. ${NEW} is a performance release: I built a benchmark harness that drives the packaged app over the DevTools protocol on generated data, profiled it, and removed the work it repeated on every click (a synchronous PowerShell lookup for Store installs, and a stat walk over thousands of files to compute a size nobody read).

Per click: ${r.click.oldText} → ${r.click.newText} on a Store install. Cold start with 25 profiles: ${r.cold.oldText} → ${r.cold.newText}. Exporting a 50 MB session: ${r.export.oldText} → ${r.export.newText} (in-process zip writer replacing Compress-Archive; archives byte-identical, verified on 3,000 random transcripts).

Only compared against my own previous version, on ${M}. Memory is unchanged and I say so. Method, raw JSON and caveats are in BENCHMARKS.md; the harness is in bench/ so you can rerun it.

${REPO}

---

# Product Hunt

**Tagline:** One identity, many facets — Claude Desktop, one profile per account

**Description:**
Facet is a tiny, open-source Windows tray launcher that opens Claude Desktop on the right account every time — work, personal, client — each in its own data directory. No token handling, no network, no telemetry.

${NEW} is the speed release: every click in the panel is ${r.click.newText} instead of ${r.click.oldText} on Store installs, the app shows your profiles in ${r.cold.newText} instead of ${r.cold.oldText} with 25 of them, and exporting a 50 MB Claude Code session takes ${r.export.newText} instead of ${r.export.oldText}. Every number comes from a benchmark suite that ships in the repo.

**First comment (maker):**
Numbers are medians of 5 runs on ${M}, packaged build, same data for both versions, compared only against Facet ${OLD}. What did *not* improve: memory (~${S.footprint.idleMemoryMB.new} MB idle, Electron's floor). Details and caveats: ${BENCH}
`,

  'store-listing.md': `# Store listings (winget / Microsoft Store description if submitted)

**Short description (≤ 100 chars):**
Run multiple Claude Desktop accounts side by side from the Windows tray. Open source, no telemetry.

**Description:**
Facet opens Claude Desktop on the right account every time. Each profile gets its own data directory, so sessions stay put and you sign in once per account. It never touches your tokens and never uses the network.

- One click per profile, Alt+1…9 hotkeys, global shortcut to open the panel
- Adopt your existing signed-in session as a profile — no re-login
- Export any Claude Code session to a zip (the archive /export used to write)
- Portable mode, enterprise policy file, launch at sign-in

Fast: the panel responds in single-digit milliseconds, and a 50 MB session exports in about ${r.export.newText} on a Ryzen 5 laptop (${NEW}, measured; see BENCHMARKS.md in the repo).

**What's new in ${NEW}:**
Faster everywhere the app used to repeat work: panel actions ${X(r.click)} faster on Microsoft Store installs of Claude, startup ${X(r.cold)} faster with many profiles, session export ${X(r.export)} faster, session list ${X(r.list)} faster. Recovery view shows unlinked folders instantly. Settings shows the real version number.
`,

  'launch-plan.md': `# Launch plan — Facet ${NEW}

## Claim rules

**Do claim**
- Any number in \`marketing/speed-data.json\`, with its scenario ("on a Store install, 3 profiles") and machine ("on a Ryzen 5 laptop").
- "N× faster" only when the ratio is ≥ 2; otherwise "N% faster". Ratios come from medians.
- "Byte-identical archives" — backed by bench/verify-export.mjs.
- "No new dependencies" — package.json devDependencies unchanged; runtime has none.

**Don't claim**
- Anything vs. another product. Nothing else was benchmarked.
- "Instant", "blazing", "zero overhead" — adjectives without a number.
- Memory or install-size improvements — there are none (Electron floor). Say so if asked.
- The ${X(r.click)} figure without the Store-install qualifier. Classic-installer users saw ${Math.round(S.classicClick.old / S.classicClick.new)}× (${Math.round(S.classicClick.old)} ms → ${Math.round(S.classicClick.new)} ms).
- Cold-start improvements for users with 1 profile and no leftover folders — it's the same within noise.
- First-open session-list speed beyond ~2× — the ${X(r.list)} is with the cache warm.

## Sequence

1. Push README speed section, BENCHMARKS.md, marketing/out images to main (links must resolve before the release goes up).
2. Tag v${NEW}, create the GitHub release with the speed table, race image, SHA-256 checksums, SmartScreen note.
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
`,
};

for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), body);
console.log(`wrote ${Object.keys(files).length} files to marketing/copy/`);
