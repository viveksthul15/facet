# Store listings (winget / Microsoft Store description if submitted)

**Short description (≤ 100 chars):**
Run multiple Claude Desktop accounts side by side from the Windows tray. Open source, no telemetry.

**Description:**
Facet opens Claude Desktop on the right account every time. Each profile gets its own data directory, so sessions stay put and you sign in once per account. It never touches your tokens and never uses the network.

- One click per profile, Alt+1…9 hotkeys, global shortcut to open the panel
- Adopt your existing signed-in session as a profile — no re-login
- Export any Claude Code session to a zip (the archive /export used to write)
- Portable mode, enterprise policy file, launch at sign-in

Fast: the panel responds in single-digit milliseconds, and a 50 MB session exports in about 5.6 s on a Ryzen 5 laptop (0.2.0, measured; see BENCHMARKS.md in the repo).

**What's new in 0.2.0:**
Faster everywhere the app used to repeat work: panel actions 251× faster on Microsoft Store installs of Claude, startup 14× faster with many profiles, session export 3.6× faster, session list 3.9× faster. Recovery view shows unlinked folders instantly. Settings shows the real version number.
