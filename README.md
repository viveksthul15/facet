# Facet

**One identity. Many facets.** A tiny Windows tray launcher that opens Claude Desktop on the right session, every time.

Run multiple Claude Desktop accounts side-by-side — work, personal, client — each in its own isolated data directory. Sign in once per profile; sessions stay put.

Inspired by [synthetixis/lanes](https://github.com/synthetixis/lanes) (macOS); rebuilt from scratch for Windows in Electron.

---

## Download

**[⬇ Facet-Setup.exe](https://github.com/viveksthul15/facet/releases/latest/download/Facet-Setup.exe)** — installer (recommended)

**[⬇ Facet-Portable.exe](https://github.com/viveksthul15/facet/releases/latest/download/Facet-Portable.exe)** — portable, no install

> **First launch — SmartScreen warning:** Windows shows *"Windows protected your PC"* because Facet is not code-signed (that would cost me $100/year for a certificate). Click **More info → Run anyway**. The source is right here — read it, build it yourself, or trust that others have.

---

## The whole trick

```
Claude.exe --user-data-dir="%LOCALAPPDATA%\Facet\profiles\claude-work"
```

Claude Desktop is Electron. Point it at a per-profile data directory and each launch gets an independent session. That's the entire mechanism.

## It never touches your tokens

- **No token handling.** Facet only *chooses a directory* and *spawns a process*. It never reads, copies, moves, or writes your session material.
- **No network, ever.** Zero analytics, zero phone-home, zero update checks.
- **Tray only.** No taskbar entry, no main window, no background services beyond the notification-area icon.

## Run from source

Requires Node.js 18+.

```
npm install
npm start
```

Click the tri-color facet mark in the notification area (bottom-right of the taskbar). Windows 11 hides new tray icons by default — click the ⌃ overflow arrow and drag Facet out to pin it.

## Build

```
npm run build
```

Produces both an NSIS installer and a portable exe under `dist/`. Requires Windows Developer Mode ON so electron-builder can extract its signing helper archive.

## Keyboard

- **Ctrl + Alt + C** (default global hotkey) — open the panel from anywhere; re-bindable in Settings
- **Alt + 1** … **Alt + 9** — launch the profile at that slot
- **Enter** on a profile — launch it
- **F2** on a profile — inline rename
- **Right-click** a profile — Launch · Open data folder · Rename · Duplicate · Remove
- **Esc** — hide the panel (or back out of Add/Manage/Settings)

## Where things live

| Thing | Path |
|---|---|
| Profile index | `%LOCALAPPDATA%\Facet\facet.json` |
| Settings | `%LOCALAPPDATA%\Facet\settings.json` |
| Profile data dirs | `%LOCALAPPDATA%\Facet\profiles\claude-<slug>\` |
| Debug logs | `%LOCALAPPDATA%\Facet\logs\YYYY-MM-DD.log` |
| Adopted profile (in place) | `%APPDATA%\Claude\` |
| Enterprise policy override | `%PROGRAMDATA%\Facet\policy.json` |

Profile data lives under `%LOCALAPPDATA%` on purpose — Chromium session state is large and shouldn't roam across machines.

## Portable mode

Drop an empty `portable.txt` next to `Facet.exe` and Facet stores everything in `FacetData/` beside itself — nothing in `%APPDATA%` or `%LOCALAPPDATA%`. Runs off a USB drive, corp-locked machine, whatever.

The portable installer above does this automatically.

## Enterprise deployment

Drop `%PROGRAMDATA%\Facet\policy.json` with any of:

```json
{
  "customClaudePath": "C:\\corp\\ClaudeManaged.exe",
  "launchAtLogin": true,
  "globalHotkey": "Control+Alt+C",
  "confirmOnQuit": true
}
```

Keys present in policy are locked in the Settings UI. Users see a lock icon and can't change them.

## Honest about what this is

Unofficial personal-productivity utility. Not affiliated with, endorsed by, or supported by Anthropic. It launches the official Claude Desktop app you already have installed; it does not modify or repackage it.

Running multiple accounts may be subject to your plan's terms — check them, especially on Team or Enterprise plans.

## License

MIT.
