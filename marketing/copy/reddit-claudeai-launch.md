# Reddit r/ClaudeAI — launch post

**Title:** I got tired of signing out of Claude Desktop to switch accounts, so I built a tray app that runs them side by side

Claude Desktop holds one account at a time. I have a work one and a personal one, and switching meant signing out, signing in, waiting, and losing whatever I had open. Every time.

Facet is a small Windows tray app that fixes it. Each profile launches Claude Desktop against its own data directory, so every account keeps its own session. Click a profile and the right Claude opens. Sign in once per account and that is the end of it.

The whole mechanism is one flag:

    Claude.exe --user-data-dir="%LOCALAPPDATA%\Facet\profiles\claude-work"

Claude Desktop is Electron, and Electron honours that flag. Facet chooses a directory and starts a process — it never reads, copies or writes your session material, and it contains no network code at all.

What it does beyond that:
- **Adopt** the account you are already signed into as a profile, without signing out
- **Alt+1…9** launches a profile; a global hotkey opens the panel
- **Export a Claude Code session** to a zip — the archive /export used to write, rebuilt, since that command is gone from the desktop app
- Portable mode for a USB stick, and a policy file if you are deploying it

Free, MIT, no telemetry, no account, no update checks: https://github.com/viveksthul15/facet

Two honest notes. It is unofficial and not affiliated with Anthropic — it launches the Claude Desktop you already have. And running multiple accounts may be subject to your plan's terms, so check them, especially on Team or Enterprise.

Windows only for now. It is Electron itself, so it costs about 333.2 MB sitting in the tray; I would rather say that than pretend otherwise.

Happy to answer anything about how it works.
