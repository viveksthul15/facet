# Show HN — launch post (blocked while the HN account has no karma; see POSTING-TRACKER)

**Title:** Show HN: Facet – run several Claude Desktop accounts side by side on Windows

**Text:**
Claude Desktop stores one signed-in account. I kept signing out of work to check personal and back again, so I wrote a tray launcher that starts it with a per-profile data directory:

    Claude.exe --user-data-dir=%LOCALAPPDATA%\Facet\profiles\claude-work

That one flag is the whole mechanism — Claude Desktop is Electron and honours it. Facet picks a directory and spawns a process. It never touches your tokens and makes no network calls of any kind: no analytics, no update check.

The parts that turned out more interesting than the idea:

- **The Microsoft Store build moves on every update.** Its install folder carries the version number, so a path cached at startup is dead by the afternoon. The launch then failed with an async ENOENT nobody was listening for: the click did nothing, and the profile kept showing a green "running" dot. Now the path is re-checked per launch, and a profile is only marked running once the process exists.
- **A window created with resizable:false keeps its current size as its minimum on Windows.** The panel could grow and never shrink, so after opening a tall view it ran past the bottom of the screen and cut off whatever sat at its foot.
- **Deep links cannot be routed to the right account.** claude:// has one handler, it names no profile, and a Store app claims the protocol by package identity — which outranks anything another program registers. Only the user can override that, in Windows Settings, by design.
- **Benchmarking the packaged build rather than the dev one found the real cost.** A click spent 1.9 s on this machine: a synchronous PowerShell lookup for where Claude lives, plus stat-ing thousands of files to compute a folder size nobody displayed. It is 8 ms now (a Ryzen 5 laptop); method and raw JSON are in the repo.

MIT, no runtime dependencies, about 3.5k lines: https://github.com/viveksthul15/facet

Unofficial, not affiliated with Anthropic. Windows only — the same trick works on macOS, but I have not built it.
