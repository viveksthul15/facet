# Privacy

Facet collects nothing, sends nothing, and has no servers.

## What Facet does

- Starts Claude Desktop with a data directory of your choosing (`--user-data-dir`).
- Keeps a list of your profiles — a name, a colour, a folder — on your own machine.
- Optionally copies a Claude Code session transcript from your disk into a zip you asked for.

## What Facet stores, and where

| What | Where |
| --- | --- |
| Profile list | `%LOCALAPPDATA%\Facet\facet.json` |
| Settings | `%LOCALAPPDATA%\Facet\settings.json` |
| Debug log (local only) | `%LOCALAPPDATA%\Facet\logs\YYYY-MM-DD.log` |
| Where Claude Desktop was last found | `%LOCALAPPDATA%\Facet\cache\claude-exe.json` |
| Claude session data, written by Claude itself | `%LOCALAPPDATA%\Facet\profiles\claude-<name>\` |

In portable mode all of it lives in `FacetData` next to the executable instead.

## What Facet never does

- **No network access.** No analytics, no crash reporting, no update checks, no phone-home. You can
  verify this: the source is public, and the panel's content security policy blocks connections
  outright (`connect-src 'none'`).
- **No token handling.** Facet chooses a directory and starts a process. It never reads, copies,
  moves or writes your Claude session material. Signing in happens inside Claude Desktop, to
  Anthropic, exactly as it would without Facet.
- **No telemetry of any kind**, including counts, timings or "anonymous" usage data.

## Removing your data

Uninstall Facet, then delete `%LOCALAPPDATA%\Facet` (or the `FacetData` folder in portable mode).
Removing a profile from inside Facet offers to delete that profile's data folder too.

## Claude Desktop itself

Facet is an unofficial utility and is not affiliated with Anthropic. Once Claude Desktop is running,
its own privacy policy applies to what it does.

Questions: https://github.com/viveksthul15/facet/issues
