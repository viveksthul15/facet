# Changelog

## 0.2.1 — 2026-09-22

### Changed
- **New colour system.** The panel now draws its colours from the shared "Aurora" design tokens
  (`ui/tokens.css`) instead of its own palette: teal accent, emerald-to-sky brand gradient on
  primary buttons, and the Aurora surface, border and text ramps in both themes. Profile accents
  come from the same families. Facet's own token names are kept as a thin mapping layer, so the
  rest of the stylesheet is unchanged.

### Fixed
- **Adopting an existing Claude session could open a signed-out window.** Facet offered adoption
  whenever `%APPDATA%\Claude` existed, even when that folder held no session — which happens with
  the Microsoft Store build on machines where Windows has not linked that path to the package's
  own storage, or where an uninstalled classic build left the folder behind. Facet now looks in
  both places, only offers adoption when a signed-in session is actually there, and shows the
  folder it found in the adopt banner.
- **An adopted profile now launches Claude the way Claude launches itself**, with no
  `--user-data-dir` override. An adopted profile *is* Claude's own session, so naming the
  directory could only ever get it wrong.
- Adopted profiles record the directory they adopted, so a later Windows or Claude change cannot
  silently repoint them. Profiles adopted before 0.2.1 keep working unchanged.
- **The panel could only ever grow, never shrink.** Its window is not resizable, and Windows then
  treats the current size as the minimum — so after any tall view (Settings, a long profile list)
  the panel stayed that tall and ran off the bottom of the screen, cutting off whatever sat at its
  foot. This is why "Got it" on the welcome card, and the adopt buttons, appeared sliced on
  smaller or scaled displays.
- **A view's content is now one scroll region instead of several.** The empty state had the hero,
  the adopt banner and the call to action each scrolling separately, so on a short panel they
  competed for space and the button lost.
- **Dialog buttons stay pinned** while the text above them scrolls, so the primary action is never
  below the fold. "Create a new profile" now sits outside the scroll region for the same reason.
- On a short panel (a small screen, or Windows at 125–150% scale) the welcome and empty states drop
  their decorative marks and tighten up, which is usually enough to avoid scrolling at all.
- `bench/verify-layout.mjs` walks every view and overlay at six screen sizes and fails on anything
  unreachable or on a window taller than the display.

## 0.2.0 — 2026-09-18

The speed release. Same features, same memory, a lot less waiting. Every number below is a
median of 5 runs on a Ryzen 5 laptop, packaged build, same data for both versions — see
[BENCHMARKS.md](BENCHMARKS.md) and `bench/results/`.

| | 0.1.2 | 0.2.0 |
|---|---:|---:|
| Every panel action, Claude from the Microsoft Store | 1.9 s | 8 ms |
| Every panel action, 25 profiles + 3 old data folders | 8.6 s | 6 ms |
| Start → profiles on screen, 25 profiles | 9.4 s | 692 ms |
| Open the session list, 215 transcripts | 1.4 s | 370 ms |
| Filter the session list, per keystroke | 79 ms | 8 ms |
| Export a 50 MB session to zip | 20 s | 5.6 s |

### Fixed
- **Store installs of Claude froze the panel for ~2 s on every click.** The Microsoft Store
  (MSIX) lookup ran through PowerShell on every refresh. It now runs once, in the background,
  and the answer is remembered on disk for as long as that Claude.exe exists.
- **Leftover data folders made every click slow.** Each refresh walked every file in every
  unlinked `profiles\` folder to compute a size the panel never showed. Refresh now only counts
  them; the Recovery view measures each folder on its own, without blocking, and shows
  "measuring…" until it has the number.
- **Session export shelled out to `Compress-Archive`** (over 90% of export time) after copying
  everything into a staging folder. The zip is now written in-process, straight from the source
  files, with big files deflated in parallel; the transcript is compressed once and stored under
  both names. Archives are byte-identical to 0.1.2 (checked on 3,000 random transcripts and 30
  full exports, extracted with Windows' own extractor). Zip64 is supported, so archives over 4 GB
  no longer fail.
- **Session list re-read every transcript on every open.** Results are cached by path, size and
  modification time; uncached transcripts are scanned by byte range and only the lines that can
  matter are parsed. Transcripts over 512 MB no longer crash the export tool.
- **Typing in the session filter rebuilt the whole panel** (and replayed its entrance animation)
  on every key. Only the rows are re-rendered now; 60 at a time, more as you scroll.
- The export tool no longer crashes on a transcript line that is bare JSON `null`.
- Settings → About showed "0.1.0" regardless of the installed version.

### Added
- **Export a Claude Code session** to the same zip layout the removed `/export` command wrote:
  tray → *Export a session…*. Lists every transcript under `~/.claude/projects`, writes
  subagents, tool results, workflows, optional app logs, plus a readable Markdown transcript.
  (Work started in 0.1.2, which was never released.)
- `bench/`: a reproducible benchmark suite that drives the packaged app over the DevTools
  protocol on generated data. `BENCHMARKS.md` documents the method and caveats.

### Unchanged
- Memory (~335 MB working set idle, 4 processes) and installer size (76 MB). That is Electron's
  floor, not something this release could move.

## 0.1.1 — 2026-08-13
- Preflight checks when naming a profile, orphan-folder recovery, focus preservation across
  re-renders, automatic backup of `facet.json`.
- Panel stays visible while native dialogs are open.

## 0.1.0 — 2026-07-15
- Initial release.
