const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile, execFileSync } = require('child_process');

// ============================================================================
// Single-instance lock — second launch focuses the existing panel and exits
// ============================================================================
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// ============================================================================
// Portable mode — --portable flag or portable.txt next to exe
// ============================================================================
const IS_PORTABLE =
  process.argv.includes('--portable') ||
  (function () {
    try { return fs.existsSync(path.join(path.dirname(process.execPath), 'portable.txt')); } catch { return false; }
  })();

const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const PROGRAM_DATA = process.env.PROGRAMDATA || 'C:\\ProgramData';
const PROFILE_ROOT = IS_PORTABLE
  ? path.join(path.dirname(process.execPath), 'FacetData')
  : path.join(LOCAL_APPDATA, 'Facet');
const PROFILES_JSON = path.join(PROFILE_ROOT, 'facet.json');
const SETTINGS_JSON = path.join(PROFILE_ROOT, 'settings.json');
const POLICY_JSON = path.join(PROGRAM_DATA, 'Facet', 'policy.json');
const LOG_DIR = path.join(PROFILE_ROOT, 'logs');
const CACHE_DIR = path.join(PROFILE_ROOT, 'cache');
const CLAUDE_EXE_CACHE_JSON = path.join(CACHE_DIR, 'claude-exe.json');
const SESSION_LIST_CACHE_JSON = path.join(CACHE_DIR, 'session-list.json');
const CLAUDE_DATA_DIR = path.join(app.getPath('appData'), 'Claude');
const CLAUDE_MSIX_PACKAGE_FAMILY = 'Claude_pzs8sxrjxfjjc';

// Where a signed-in Claude Desktop keeps its session. The classic installer uses %APPDATA%\Claude.
// The Microsoft Store build writes into its package container instead; Windows usually exposes that
// as a link at %APPDATA%\Claude, but not on every machine — and where the link is missing, that
// folder can still exist and be empty (an uninstalled classic build leaves one behind). Adopting
// the empty one is what produced a signed-out window, so both are checked and only a directory
// that actually holds session state counts.
const CLAUDE_MSIX_DATA_DIR = path.join(
  LOCAL_APPDATA, 'Packages', CLAUDE_MSIX_PACKAGE_FAMILY, 'LocalCache', 'Roaming', 'Claude');
const CLAUDE_DATA_CANDIDATES = [CLAUDE_DATA_DIR, CLAUDE_MSIX_DATA_DIR];
// Chromium writes these once a profile is signed in; an empty or freshly created directory has none.
const SESSION_MARKERS = ['Local Storage', 'IndexedDB', path.join('Network', 'Cookies')];

const CLAUDE_EXE_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude-desktop', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe'),
];

// ============================================================================
// claude:// links
//
// Clicking "Open desktop app" on the web opens whatever Windows has registered for claude://,
// which is one Claude.exe with no --user-data-dir — so the link lands in the default data
// directory, whatever account that happens to hold. The link itself names no account (it is a
// path and a few query parameters), so the only way to get it to the right profile is to ask.
// With the setting below on, Facet registers itself for claude:// and forwards the link to the
// profile you pick.
// ============================================================================
const LINK_PROTOCOL = 'claude';
const LINK_KEY = `HKCU\\Software\\Classes\\${LINK_PROTOCOL}`;

const DEFAULT_SETTINGS = {
  customClaudePath: null,
  launchAtLogin: false,
  globalHotkey: 'Control+Alt+C',
  confirmOnQuit: true,
  onboardingComplete: false,
  handleClaudeLinks: false,
};

let tray = null;
let panel = null;
let currentHotkey = null;
let dialogSuppressBlur = 0;

// Wrap any main-process dialog that should not cause the panel to hide.
// Increments a counter (so nested/overlapping dialogs behave), decrements
// on completion, and refocuses the panel so users see the updated state.
async function withDialogGuard(fn) {
  dialogSuppressBlur++;
  try {
    return await fn();
  } finally {
    dialogSuppressBlur--;
    // Return focus to the panel so it stays visible instead of quietly hiding
    setTimeout(() => { if (panel && !panel.isDestroyed()) panel.focus(); }, 60);
  }
}
let isQuitting = false;
const running = new Set();

// ============================================================================
// Structured logging — %LOCALAPPDATA%\Facet\logs\YYYY-MM-DD.log
// ============================================================================
function log(level, ...args) {
  const stamp = new Date().toISOString();
  const line = `${stamp} [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${stamp.slice(0, 10)}.log`);
    fs.appendFileSync(file, line);
  } catch {}
  if (level === 'error' || level === 'warn') console.error(line.trim());
}

process.on('uncaughtException', (e) => { log('error', 'uncaught', e && e.stack || e); });
process.on('unhandledRejection', (e) => { log('error', 'unhandled', e && e.stack || e); });

// ============================================================================
// Persistence — profiles, settings, policy (with atomic writes)
// ============================================================================
function ensureRoot() {
  if (!fs.existsSync(PROFILE_ROOT)) fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  if (!fs.existsSync(PROFILES_JSON)) fs.writeFileSync(PROFILES_JSON, JSON.stringify({ profiles: [] }, null, 2));
}

function loadProfiles() {
  ensureRoot();
  try { return JSON.parse(fs.readFileSync(PROFILES_JSON, 'utf8')).profiles || []; }
  catch (e) { log('warn', 'profiles.json unreadable', e.message); return []; }
}

function saveProfiles(profiles) {
  ensureRoot();
  // Keep the previous version as a backup so a bad write is recoverable
  try {
    if (fs.existsSync(PROFILES_JSON)) fs.copyFileSync(PROFILES_JSON, PROFILES_JSON + '.bak');
  } catch (e) { log('warn', 'facet.json backup failed', e.message); }
  const tmp = PROFILES_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ profiles }, null, 2));
  fs.renameSync(tmp, PROFILES_JSON);
}

// ============================================================================
// Orphan detection — folders under profiles/ that no facet.json entry claims
// ============================================================================
// Names only — one readdir. profiles:list runs on every panel refresh and needs just the count.
function orphanDirNames(profiles = loadProfiles()) {
  const dir = path.join(PROFILE_ROOT, 'profiles');
  const claimed = new Set(profiles.filter(p => !p.adopted).map(p => p.slug));
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return items.filter(d => d.isDirectory() && !claimed.has(d.name)).map(d => d.name);
}

// Sizes are NOT computed here: walking a Chromium data dir is thousands of stat calls. The
// Recovery view asks for each folder's size separately (profiles:orphanSize).
function listOrphanSlugs() {
  const dir = path.join(PROFILE_ROOT, 'profiles');
  return orphanDirNames()
    .map(name => {
      const full = path.join(dir, name);
      let mtime = null, hasSession = false;
      try {
        mtime = fs.statSync(full).mtime.toISOString();
        // Session markers: presence of Local Storage or IndexedDB means a real signed-in dir
        hasSession = fs.existsSync(path.join(full, 'Local Storage')) ||
                     fs.existsSync(path.join(full, 'IndexedDB'));
      } catch {}
      return { slug: name, path: full, mtime, size: null, hasSession };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
}

// Async so the tray and panel stay responsive; stats run in parallel on the libuv pool.
async function folderSize(root) {
  let total = 0;
  const dirs = [root];
  const STAT_BATCH = 64;
  while (dirs.length) {
    const p = dirs.pop();
    let items;
    try { items = await fs.promises.readdir(p, { withFileTypes: true }); } catch { continue; }
    const files = [];
    for (const it of items) {
      const full = path.join(p, it.name);
      if (it.isDirectory()) dirs.push(full); else files.push(full);
    }
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      const sizes = await Promise.all(files.slice(i, i + STAT_BATCH)
        .map(f => fs.promises.stat(f).then(st => st.size, () => 0)));
      for (const n of sizes) total += n;
    }
  }
  return total;
}

function hasAnyAdopted(profiles = loadProfiles()) {
  return profiles.some(p => p.adopted);
}

function loadUserSettings() {
  ensureRoot();
  try { return JSON.parse(fs.readFileSync(SETTINGS_JSON, 'utf8')); }
  catch { return {}; }
}

function saveUserSettings(next) {
  ensureRoot();
  const tmp = SETTINGS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, SETTINGS_JSON);
}

function loadPolicy() {
  try { return JSON.parse(fs.readFileSync(POLICY_JSON, 'utf8')); }
  catch { return {}; }
}

/**
 * Effective settings = DEFAULT ← user ← policy (policy wins).
 * Also returns the list of keys that are locked by policy.
 */
function getEffectiveSettings() {
  const user = loadUserSettings();
  const policy = loadPolicy();
  const effective = { ...DEFAULT_SETTINGS, ...user, ...policy };
  const locked = Object.keys(policy);
  return { effective, user, policy, locked };
}

// Public "settings" for consumers — returns effective view
function loadSettings() { return getEffectiveSettings().effective; }

// ============================================================================
// Registry helpers — only ever used under HKCU\Software\Classes\claude
// ============================================================================
function regQuery(key, valueName) {
  try {
    const args = ['query', key, ...(valueName ? ['/v', valueName] : ['/ve'])];
    const out = execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/REG_[A-Z_]+\s+(.*)/);
    return m ? m[1].trim() : null;
  } catch { return null; }   // the key does not exist
}

function regSet(key, valueName, data) {
  const args = ['add', key, ...(valueName ? ['/v', valueName] : ['/ve']), '/t', 'REG_SZ', '/d', data, '/f'];
  execFileSync('reg.exe', args, { windowsHide: true, stdio: 'ignore' });
}

/** What Windows should run for a claude:// link while Facet is handling them. */
function facetLinkCommand() {
  return `"${process.execPath}"${IS_PORTABLE ? ' --portable' : ''} "%1"`;
}

const currentLinkCommand = () => regQuery(`${LINK_KEY}\\shell\\open\\command`);

function facetHandlesLinks() {
  const cur = currentLinkCommand();
  return !!cur && cur.toLowerCase().includes(process.execPath.toLowerCase());
}

/**
 * Take over claude:// for Facet, remembering whoever held it before (normally Claude itself) so it
 * can be put back. Claude re-registers the protocol when it updates, so this also runs at startup
 * while the setting is on.
 */
function claimClaudeLinks() {
  try {
    const before = currentLinkCommand();
    if (before && !before.toLowerCase().includes(process.execPath.toLowerCase())) {
      const user = loadUserSettings();
      user.claudeLinkBackup = before;             // only the first, real owner is kept
      saveUserSettings(user);
    }
    regSet(LINK_KEY, null, `URL:${LINK_PROTOCOL}`);
    regSet(LINK_KEY, 'URL Protocol', '');
    regSet(`${LINK_KEY}\\shell\\open\\command`, null, facetLinkCommand());
    log('info', 'claude:// links now open through Facet');
    return { ok: true };
  } catch (e) {
    log('error', 'could not register claude:// links', e.message);
    return { ok: false, error: e.message };
  }
}

/** Hand claude:// back to whatever had it before Facet took over. */
function releaseClaudeLinks() {
  try {
    const backup = loadUserSettings().claudeLinkBackup;
    if (backup) {
      regSet(`${LINK_KEY}\\shell\\open\\command`, null, backup);
      log('info', 'claude:// links handed back', backup);
    } else {
      try { execFileSync('reg.exe', ['delete', LINK_KEY, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
      log('info', 'claude:// registration removed');
    }
    const user = loadUserSettings();
    delete user.claudeLinkBackup;
    saveUserSettings(user);
    return { ok: true };
  } catch (e) {
    log('error', 'could not restore claude:// links', e.message);
    return { ok: false, error: e.message };
  }
}

function syncClaudeLinks() {
  if (process.platform !== 'win32') return;
  const on = !!loadSettings().handleClaudeLinks;
  if (on && !facetHandlesLinks()) claimClaudeLinks();      // Claude takes it back on every update
  else if (!on && facetHandlesLinks()) releaseClaudeLinks();
}

// A link can arrive before the panel exists — Windows starts Facet to handle it — so it waits here.
let pendingLink = null;

const linkFromArgv = (argv) => (argv || []).find((a) => typeof a === 'string' && a.startsWith(`${LINK_PROTOCOL}://`)) || null;

function offerLink(url) {
  if (!url) return;
  pendingLink = url;
  log('info', 'claude:// link received', url.slice(0, 120));
  if (!panel || panel.isDestroyed()) return;              // picked up once the panel has loaded
  panel.webContents.send('open-link', { url });
  positionPanel(tray && tray.getBounds());
  panel.show();
  panel.focus();
}

// ============================================================================
// Claude.exe detection with a small cache + health check
// ============================================================================
let claudeExeCache = { done: false, path: null, source: null };

// The Store (MSIX) lookup shells out to PowerShell — about two seconds. Its answer is remembered
// on disk and trusted for as long as the exe it names still exists (a Claude update moves the
// install folder, which fails that check and triggers a fresh lookup).
let msixKnown;        // undefined = never looked, null = looked and found nothing, string = exe
let msixProbe = null; // in-flight background lookup
let msixLastMissAt = 0;
const MSIX_RETRY_MS = 60 * 1000;
const MSIX_LOOKUP_COMMAND =
  `Get-AppxPackage | Where-Object PackageFamilyName -eq ${CLAUDE_MSIX_PACKAGE_FAMILY} | Select-Object -ExpandProperty InstallLocation`;

function loadMsixKnown() {
  if (msixKnown !== undefined) return msixKnown;
  try {
    const c = JSON.parse(fs.readFileSync(CLAUDE_EXE_CACHE_JSON, 'utf8'));
    if (c && 'msix' in c) msixKnown = typeof c.msix === 'string' ? c.msix : null;
  } catch {}
  return msixKnown;
}

function rememberMsix(exe) {
  msixKnown = exe;
  if (!exe) msixLastMissAt = Date.now();
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CLAUDE_EXE_CACHE_JSON, JSON.stringify({ msix: exe }));
  } catch (e) { log('warn', 'claude-exe cache write failed', e.message); }
}

function forgetClaudeExe() {
  claudeExeCache = { done: false, path: null, source: null };
  msixKnown = undefined;
  try { fs.rmSync(CLAUDE_EXE_CACHE_JSON, { force: true }); } catch {}
}

function msixExeFromOutput(stdout) {
  const out = String(stdout || '').trim();
  if (!out) return null;
  const exe = path.join(out, 'app', 'Claude.exe');
  return fs.existsSync(exe) ? exe : null;
}

// Custom path, then the classic installer locations. Cheap: a settings read and a few existsSync.
function findClaudeExeLocal() {
  const settings = loadSettings();
  if (settings.customClaudePath) {
    if (fs.existsSync(settings.customClaudePath)) return { path: settings.customClaudePath, source: 'custom' };
    // Custom path has become invalid — clear it and fall through to auto-detect
    log('warn', 'customClaudePath no longer exists, clearing:', settings.customClaudePath);
    const user = loadUserSettings();
    delete user.customClaudePath;
    saveUserSettings(user);
  }
  for (const p of CLAUDE_EXE_CANDIDATES) {
    if (p && fs.existsSync(p)) return { path: p, source: 'installer' };
  }
  return null;
}

// Blocking — used by a launch, which cannot proceed without an answer.
function findClaudeExe() {
  if (claudeExeCache.done) return claudeExeCache.path;
  const local = findClaudeExeLocal();
  if (local) {
    claudeExeCache = { done: true, ...local };
    return local.path;
  }
  const known = loadMsixKnown();
  const msix = known && fs.existsSync(known) ? known : findMsixClaudeExe();
  claudeExeCache = { done: true, path: msix, source: msix ? 'msix' : null };
  return msix;
}

/**
 * Same precedence as findClaudeExe, but never blocks — this is what every panel refresh uses.
 * When the Store lookup is needed it runs in the background and the panel is refreshed when it
 * lands; `probing` tells the UI not to claim "not found" in the meantime.
 */
function resolveClaudeExeFast() {
  const local = findClaudeExeLocal();
  if (local) {
    claudeExeCache = { done: true, ...local };
    return { ...local, probing: false };
  }
  const known = loadMsixKnown();
  if (known && fs.existsSync(known)) {
    claudeExeCache = { done: true, path: known, source: 'msix' };
    return { path: known, source: 'msix', probing: false };
  }
  claudeExeCache = { done: false, path: null, source: null };
  const recentlyMissed = known === null && Date.now() - msixLastMissAt < MSIX_RETRY_MS;
  if (!recentlyMissed) startMsixProbe();
  return { path: null, source: null, probing: !!msixProbe };
}

function startMsixProbe() {
  if (msixProbe) return;
  msixProbe = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', MSIX_LOOKUP_COMMAND],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }, (err, stdout) => {
        if (err) log('warn', 'MSIX detection failed', err.message);
        resolve(err ? null : msixExeFromOutput(stdout));
      });
  }).then((exe) => {
    msixProbe = null;
    rememberMsix(exe);
    if (panel && !panel.isDestroyed()) panel.webContents.send('refresh');
  });
}

function findMsixClaudeExe() {
  try {
    const exe = msixExeFromOutput(execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', MSIX_LOOKUP_COMMAND,
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 }));
    rememberMsix(exe);
    return exe;
  } catch (e) {
    log('warn', 'MSIX detection failed', e.message);
    return null;
  }
}

function invalidateClaudeExeCache() {
  claudeExeCache = { done: false, path: null, source: null };
}

function hasClaudeSession(dir) {
  try { return SESSION_MARKERS.some(m => fs.existsSync(path.join(dir, m))); }
  catch { return false; }
}

/**
 * The signed-in Claude data directory to offer for adoption, or null when there is nothing to
 * adopt. Candidates that resolve to the same folder (the Store link) are only considered once,
 * and when both hold a session the more recently used one wins.
 */
function detectAdoptableDir() {
  const seen = new Set();
  const found = [];
  for (const dir of CLAUDE_DATA_CANDIDATES) {
    if (!dir || !fs.existsSync(dir)) continue;
    let real = dir;
    try { real = fs.realpathSync.native(dir); } catch {}
    const key = real.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasClaudeSession(dir)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, 'Local Storage')).mtimeMs || fs.statSync(dir).mtimeMs; } catch {}
    found.push({ dir, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found[0].dir : null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lane';
}

function profileDir(profile) {
  // Adopted profiles carry the directory that was adopted; profiles adopted before 0.2.1 predate
  // that field and always meant %APPDATA%\Claude.
  if (profile.adopted) return profile.dataDir || CLAUDE_DATA_DIR;
  return path.join(PROFILE_ROOT, 'profiles', profile.slug);
}

function launchProfile(profile, retried = false, extraArgs = []) {
  // A Microsoft Store update moves Claude — its folder carries the version number — so a path
  // that was right when Facet started can be gone by the time you click. Re-check it here, or
  // the spawn fails with ENOENT while the profile shows as running.
  if (claudeExeCache.done && claudeExeCache.path && !fs.existsSync(claudeExeCache.path)) {
    log('info', 'claude moved, re-detecting', claudeExeCache.path);
    forgetClaudeExe();
  }
  const exe = findClaudeExe();
  if (!exe) {
    log('warn', 'launch failed: claude not found', profile.name);
    dialog.showErrorBox('Claude Desktop not found',
      'Facet could not find Claude.exe.\n\n' +
      'Install Claude Desktop from https://claude.ai/download, or set a custom path from Facet → Settings.\n\n' +
      'Checked:\n' + CLAUDE_EXE_CANDIDATES.map(p => '  ' + p).join('\n') +
      `\n  Microsoft Store package "${CLAUDE_MSIX_PACKAGE_FAMILY}" via Get-AppxPackage`);
    return { ok: false, error: 'claude-not-found' };
  }
  const dir = profileDir(profile);
  if (!profile.adopted && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // An adopted profile IS Claude's own session, so it launches the way Claude launches itself.
  // Naming the directory explicitly is what broke the Store build on a machine without the
  // %APPDATA%\Claude link: the path existed, held no session, and Claude opened signed out.
  const args = [...(profile.adopted ? [] : [`--user-data-dir=${dir}`]), ...extraArgs];
  try {
    const child = spawn(exe, args, {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    // 'spawn' fires only once the process really exists, so a profile is never shown as running
    // because of a launch that failed.
    child.on('spawn', () => {
      running.add(profile.id);
      broadcastRunning();
    });
    child.on('exit', () => {
      running.delete(profile.id);
      broadcastRunning();
    });
    // spawn reports failure asynchronously; without this listener it became an uncaught exception
    // and the click did nothing at all.
    child.on('error', (e) => {
      running.delete(profile.id);
      broadcastRunning();
      log('error', 'launch failed', { name: profile.name, code: e.code, message: e.message });
      if (e.code === 'ENOENT' && !retried) {
        forgetClaudeExe();
        const again = launchProfile(profile, true, extraArgs);
        if (again.ok) return;
      }
      dialog.showErrorBox('Claude Desktop did not start',
        `Facet tried to run:
${exe}

${e.message}

` +
        'If Claude Desktop updated or was reinstalled, open Facet → Settings to check the path, ' +
        'or start Claude once from the Start menu and try again.');
    });
    const link = extraArgs.find((a) => typeof a === 'string' && a.startsWith(`${LINK_PROTOCOL}://`));
    log('info', 'launched', { id: profile.id, name: profile.name, adopted: !!profile.adopted,
      dir: profile.adopted ? `${dir} (Claude default)` : dir, ...(link ? { link: link.slice(0, 120) } : {}) });
    return { ok: true };
  } catch (e) {
    log('error', 'spawn failed', e.message);
    dialog.showErrorBox('Launch failed', `Could not start Claude Desktop: ${e.message}`);
    return { ok: false, error: 'spawn-failed' };
  }
}

function broadcastRunning() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('running-changed', Array.from(running));
}

// ============================================================================
// Tray icon generation
// ============================================================================
function createTrayIcon() {
  const iconPath32 = path.join(__dirname, 'assets', 'tray.png');
  if (fs.existsSync(iconPath32)) return nativeImage.createFromPath(iconPath32);
  return nativeImage.createFromBuffer(generateTrayPng(32));
}

function generateTrayPng(size) {
  const scale = size / 16;
  const px = Buffer.alloc(size * size * 4);
  const colors = [
    [110, 134, 255, 255],
    [74, 222, 128, 255],
    [245, 158, 11, 255],
  ];
  const barW = Math.max(1, Math.round(2 * scale));
  const gap = Math.max(1, Math.round(2 * scale));
  const barsWidth = 3 * barW + 2 * gap;
  const startX = Math.round((size - barsWidth) / 2);
  const heights = [10, 12, 8].map(h => Math.round(h * scale));
  const baseY = size - Math.round(2 * scale);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = [0, 0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const bx = startX + i * (barW + gap);
        if (x >= bx && x < bx + barW && y >= baseY - heights[i] && y < baseY) {
          color = colors[i];
        }
      }
      const o = (y * size + x) * 4;
      px[o] = color[0]; px[o + 1] = color[1]; px[o + 2] = color[2]; px[o + 3] = color[3];
    }
  }
  return pngEncode(size, size, px);
}

function pngEncode(width, height, rgba) {
  const zlib = require('zlib');
  const crc32 = (buf) => {
    const table = pngEncode._crcTable || (pngEncode._crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      return t;
    })());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ============================================================================
// Panel window + positioning
// ============================================================================
function createPanel() {
  panel = new BrowserWindow({
    width: 340,
    height: 560,
    minHeight: 240,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panel.webContents.on('did-finish-load', () => { if (pendingLink) offerLink(pendingLink); });
  panel.loadFile(path.join(__dirname, 'ui', 'panel.html'))
    .catch((e) => reportStartupFailure('Loading the panel', e));
  panel.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return; // aborted, e.g. a reload that superseded this one
    reportStartupFailure('Loading the panel', new Error(`${desc} (${code})`));
  });
  panel.webContents.on('render-process-gone', (_e, details) => {
    log('error', 'panel process gone', details);
    if (details.reason !== 'clean-exit') panel.reload();   // once; a second failure surfaces above
  });
  panel.on('blur', () => {
    // Don't auto-hide while a native OS dialog (file picker, confirm) is up —
    // otherwise focus stealing collapses the panel behind the dialog.
    if (dialogSuppressBlur > 0) return;
    if (panel && panel.isVisible()) panel.hide();
  });
  panel.setMenuBarVisibility(false);
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // block window.open
  panel.webContents.on('will-navigate', (e) => e.preventDefault());   // block navigation
}

function positionPanel(trayBounds) {
  if (!panel) return;
  const anchor = trayBounds && trayBounds.width
    ? { x: trayBounds.x, y: trayBounds.y }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchor);
  const { width: sw, height: sh, x: sx, y: sy } = display.workArea;
  const [pw, ph] = panel.getSize();
  const margin = 8;
  let x, y;
  if (trayBounds && trayBounds.width) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - pw / 2);
    y = trayBounds.y - ph - margin;
    if (y < sy + margin) y = trayBounds.y + trayBounds.height + margin;
  } else {
    x = anchor.x - pw / 2;
    y = anchor.y - ph - margin;
    if (y < sy + margin) y = anchor.y + margin;
  }
  x = Math.max(sx + margin, Math.min(x, sx + sw - pw - margin));
  y = Math.max(sy + margin, Math.min(y, sy + sh - ph - margin));
  panel.setPosition(Math.round(x), Math.round(y), false);
}

function togglePanel(bounds) {
  if (!panel) return;
  if (panel.isVisible()) { panel.hide(); return; }
  positionPanel(bounds);
  panel.show();
  panel.focus();
}

// ============================================================================
// Tray context menu + system integration (launch-at-login, global hotkey)
// ============================================================================
function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open profiles panel', click: () => togglePanel(tray.getBounds()) },
    { type: 'separator' },
    { label: 'Export a session…', click: () => {
        togglePanel(tray.getBounds());
        if (panel && !panel.isDestroyed()) panel.webContents.send('goto-view', 'sessions');
      } },
    { label: 'Open data folder', click: () => shell.openPath(PROFILE_ROOT) },
    { label: 'Settings', click: () => {
        togglePanel(tray.getBounds());
        if (panel && !panel.isDestroyed()) panel.webContents.send('goto-view', 'settings');
      } },
    { label: 'About Facet', click: () => dialog.showMessageBox({
        type: 'info',
        title: 'Facet',
        message: 'Facet — one identity, many facets',
        detail: `Version ${app.getVersion()}\n\nLaunches Claude Desktop with a per-profile --user-data-dir.\nNo network. No token handling. Data stays local.\n\nProfiles: ${PROFILE_ROOT}\nPortable: ${IS_PORTABLE ? 'yes' : 'no'}`,
        buttons: ['OK'],
      }) },
    { type: 'separator' },
    { label: 'Quit', click: attemptQuit },
  ]);
}

function syncLaunchAtLogin() {
  if (process.platform !== 'win32') return;
  try {
    const s = loadSettings();
    app.setLoginItemSettings({
      openAtLogin: !!s.launchAtLogin,
      path: process.execPath,
      args: IS_PORTABLE ? ['--portable'] : [],
    });
  } catch (e) {
    log('warn', 'setLoginItemSettings failed', e.message);
  }
}

function syncGlobalHotkey() {
  try { if (currentHotkey) globalShortcut.unregister(currentHotkey); } catch {}
  currentHotkey = null;
  const s = loadSettings();
  const desired = (s.globalHotkey || '').trim();
  if (!desired) return;
  try {
    const ok = globalShortcut.register(desired, () => {
      togglePanel(tray && tray.getBounds());
    });
    if (ok) {
      currentHotkey = desired;
      log('info', 'global hotkey registered', desired);
    } else {
      log('warn', 'global hotkey rejected (in use?)', desired);
    }
  } catch (e) {
    log('warn', 'global hotkey error', e.message);
  }
}

// ============================================================================
// Quit handling — confirm if profiles running
// ============================================================================
function attemptQuit() {
  const s = loadSettings();
  if (s.confirmOnQuit && running.size > 0) {
    const r = dialog.showMessageBoxSync({
      type: 'question',
      title: 'Quit Facet?',
      message: `${running.size} Claude profile${running.size === 1 ? '' : 's'} running.`,
      detail: 'Facet will exit. Your Claude windows will keep running — quit them separately.',
      buttons: ['Quit Facet', 'Cancel'],
      defaultId: 1, cancelId: 1,
    });
    if (r !== 0) return;
  }
  isQuitting = true;
  app.quit();
}

// ============================================================================
// App lifecycle
// ============================================================================
app.on('second-instance', (_e, argv) => {
  const url = linkFromArgv(argv);
  if (url) return offerLink(url);
  if (panel) togglePanel(tray && tray.getBounds());
});

// Facet has no window of its own until you click the tray icon, so a failure during startup is
// invisible: the process runs, nothing appears, and there is nothing to report. Anything that goes
// wrong here is written to startup.log and shown once.
let startupFailed = false;

function reportStartupFailure(stage, err) {
  if (startupFailed) return;
  startupFailed = true;
  const detail = err && (err.stack || err.message) || String(err);
  log('error', 'startup failed', { stage, detail });
  try {
    fs.mkdirSync(PROFILE_ROOT, { recursive: true });
    fs.writeFileSync(path.join(PROFILE_ROOT, 'startup.log'),
      `${new Date().toISOString()}  Facet ${app.getVersion()}  stage=${stage}
${detail}
`);
  } catch {}
  try {
    dialog.showErrorBox('Facet could not start',
      `${stage} failed.

${detail}

Details were written to:
${path.join(PROFILE_ROOT, 'startup.log')}`);
  } catch {}
}

app.whenReady().then(() => {
  try {
    ensureRoot();
    log('info', 'Facet starting', { portable: IS_PORTABLE, root: PROFILE_ROOT });
  } catch (e) { return reportStartupFailure('Preparing the data folder', e); }

  try {
    const image = createTrayIcon();
    tray = new Tray(image);
    tray.setToolTip('Facet — Claude profiles');
    tray.setContextMenu(buildContextMenu());
    tray.on('click', () => togglePanel(tray.getBounds()));
  } catch (e) { return reportStartupFailure('Creating the tray icon', e); }

  try { createPanel(); } catch (e) { return reportStartupFailure('Creating the panel window', e); }

  // None of these stop Facet working, so they only get logged.
  try { syncLaunchAtLogin(); } catch (e) { log('warn', 'launch-at-login failed', e.message); }
  try { syncGlobalHotkey(); } catch (e) { log('warn', 'global hotkey failed', e.message); }
  try { syncClaudeLinks(); } catch (e) { log('warn', 'claude:// sync failed', e.message); }
  // Windows may have started Facet only to open a link.
  try { offerLink(linkFromArgv(process.argv)); } catch (e) { log('warn', 'link handling failed', e.message); }
}).catch((e) => reportStartupFailure('Starting up', e));

app.on('window-all-closed', (e) => { if (!isQuitting) e.preventDefault(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });

// ============================================================================
// IPC — panel/renderer surface
// ============================================================================
ipcMain.handle('profiles:list', () => {
  const { effective, locked } = getEffectiveSettings();
  const profiles = loadProfiles();
  const orphans = orphanDirNames(profiles);
  const claude = resolveClaudeExeFast();
  const adoptableDir = detectAdoptableDir();
  return {
    profiles,
    running: Array.from(running),
    claudeExe: claude.path,
    claudeExeSource: claude.source,
    claudeExeProbing: claude.probing,
    adoptable: !!adoptableDir,
    adoptableDir,
    paths: { root: PROFILE_ROOT, claudeData: adoptableDir || CLAUDE_DATA_DIR },
    settings: effective,
    lockedSettings: locked,
    portable: IS_PORTABLE,
    version: app.getVersion(),
    orphanCount: orphans.length,
  };
});

ipcMain.handle('settings:get', () => {
  const { effective, locked } = getEffectiveSettings();
  return { settings: effective, locked };
});

ipcMain.handle('settings:set', (_e, patch) => {
  const policy = loadPolicy();
  const current = loadUserSettings();
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (policy[k] !== undefined) continue; // policy-locked; silently ignore
    if (v === null || v === '') delete next[k]; else next[k] = v;
  }
  saveUserSettings(next);
  invalidateClaudeExeCache();
  if ('launchAtLogin' in patch) syncLaunchAtLogin();
  if ('globalHotkey' in patch) syncGlobalHotkey();
  if ('handleClaudeLinks' in patch) syncClaudeLinks();
  const { effective, locked } = getEffectiveSettings();
  return { settings: effective, locked };
});

ipcMain.handle('settings:pickClaudeExe', async () => {
  return withDialogGuard(async () => {
    const r = await dialog.showOpenDialog(panel, {
      title: 'Locate Claude.exe',
      properties: ['openFile'],
      filters: [{ name: 'Claude Desktop', extensions: ['exe'] }],
      defaultPath: process.env.LOCALAPPDATA || undefined,
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const picked = r.filePaths[0];
    if (!fs.existsSync(picked)) return { ok: false, error: 'not-found' };
    return { ok: true, path: picked };
  });
});

ipcMain.handle('profiles:add', (_e, { name, color, adopted, orphanAction }) => {
  const profiles = loadProfiles();
  const slug = slugify(name);
  // Guard: no two profiles with the same name
  if (profiles.some(p => p.slug === slug)) {
    return { ok: false, error: 'duplicate-name' };
  }
  // Guard: at most one adopted profile — otherwise clicking either does the same thing
  if (adopted && hasAnyAdopted(profiles)) {
    return { ok: false, error: 'already-adopted' };
  }
  let adoptedDir = null;
  if (adopted) {
    adoptedDir = detectAdoptableDir();
    if (!adoptedDir) return { ok: false, error: 'no-session-to-adopt' };
  }
  // Guard: for a non-adopted (fresh) profile, if the slug's folder already exists on disk,
  // the caller must tell us what to do — reuse the existing data or wipe it. This is the
  // exact bug that caused a "wrong Personal" to appear: silent reuse of stale data.
  if (!adopted) {
    const dir = path.join(PROFILE_ROOT, 'profiles', slug);
    if (fs.existsSync(dir)) {
      if (orphanAction === 'wipe') {
        try { fs.rmSync(dir, { recursive: true, force: true }); }
        catch (e) { log('error', 'wipe failed', e.message); return { ok: false, error: 'wipe-failed' }; }
      } else if (orphanAction !== 'recover') {
        return { ok: false, error: 'orphan-exists', orphanPath: dir };
      }
      // 'recover' falls through and reuses the existing data as-is
    }
  }
  const profile = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(), slug,
    color: color || 'indigo',
    adopted: !!adopted,
    ...(adoptedDir ? { dataDir: adoptedDir } : {}),
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  saveProfiles(profiles);
  log('info', 'profile added', { id: profile.id, name: profile.name, adopted: profile.adopted });
  return { ok: true, profile };
});

// Cheap read-only check the UI calls while the user is typing a new profile name
ipcMain.handle('profiles:preflight', (_e, { name, adopted }) => {
  const slug = slugify(name || '');
  if (!slug) return { slug: '', ok: false, reason: 'empty' };
  const profiles = loadProfiles();
  if (profiles.some(p => p.slug === slug)) return { slug, ok: false, reason: 'duplicate-name' };
  if (adopted && hasAnyAdopted(profiles)) return { slug, ok: false, reason: 'already-adopted' };
  if (!adopted) {
    const dir = path.join(PROFILE_ROOT, 'profiles', slug);
    if (fs.existsSync(dir)) {
      return { slug, ok: true, warn: 'orphan-exists', orphanPath: dir, hasSession:
        fs.existsSync(path.join(dir, 'Local Storage')) || fs.existsSync(path.join(dir, 'IndexedDB')) };
    }
  }
  return { slug, ok: true };
});

// Orphan recovery / cleanup — surfaces the folders we found in listOrphanSlugs()
ipcMain.handle('profiles:listOrphans', () => listOrphanSlugs());

ipcMain.handle('profiles:orphanSize', async (_e, { slug }) => {
  if (!orphanDirNames().includes(slug)) return { ok: false, error: 'not-orphan' };
  return { ok: true, slug, size: await folderSize(path.join(PROFILE_ROOT, 'profiles', slug)) };
});

ipcMain.handle('profiles:recoverOrphan', (_e, { slug, name, color }) => {
  if (!orphanDirNames().includes(slug)) return { ok: false, error: 'not-orphan' };
  const profiles = loadProfiles();
  if (profiles.some(p => p.slug === slug)) return { ok: false, error: 'slug-taken' };
  const profile = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: (name || slug).trim(),
    slug,
    color: color || 'indigo',
    adopted: false,
    createdAt: new Date().toISOString(),
    recovered: true,
  };
  profiles.push(profile);
  saveProfiles(profiles);
  log('info', 'orphan recovered', { id: profile.id, name: profile.name, slug });
  return { ok: true, profile };
});

ipcMain.handle('profiles:deleteOrphan', (_e, { slug }) => {
  const dir = path.join(PROFILE_ROOT, 'profiles', slug);
  // Safety: refuse to delete anything that a profile currently claims
  const profiles = loadProfiles();
  if (profiles.some(p => !p.adopted && p.slug === slug)) return { ok: false, error: 'claimed' };
  if (!fs.existsSync(dir)) return { ok: false, error: 'not-found' };
  try { fs.rmSync(dir, { recursive: true, force: true }); }
  catch (e) { log('error', 'deleteOrphan failed', e.message); return { ok: false, error: e.message }; }
  log('info', 'orphan deleted', slug);
  return { ok: true };
});

ipcMain.handle('profiles:remove', (_e, { id, deleteData }) => {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx < 0) return { ok: false, error: 'not-found' };
  const [p] = profiles.splice(idx, 1);
  saveProfiles(profiles);
  if (deleteData && !p.adopted) {
    const dir = path.join(PROFILE_ROOT, 'profiles', p.slug);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  running.delete(id);
  log('info', 'profile removed', { id, name: p.name, adopted: !!p.adopted, deleteData: !!deleteData });
  return { ok: true };
});

ipcMain.handle('profiles:rename', (_e, { id, name }) => {
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not-found' };
  p.name = name.trim();
  saveProfiles(profiles);
  return { ok: true };
});

ipcMain.handle('profiles:setColor', (_e, { id, color }) => {
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not-found' };
  p.color = color;
  saveProfiles(profiles);
  return { ok: true };
});

ipcMain.handle('profiles:reorder', (_e, { id, direction }) => {
  const profiles = loadProfiles();
  const i = profiles.findIndex(p => p.id === id);
  if (i < 0) return { ok: false, error: 'not-found' };
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= profiles.length) return { ok: true }; // clamp silently
  [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
  saveProfiles(profiles);
  return { ok: true };
});

ipcMain.handle('profiles:duplicate', (_e, { id }) => {
  const profiles = loadProfiles();
  const src = profiles.find(p => p.id === id);
  if (!src) return { ok: false, error: 'not-found' };
  let baseName = `${src.name} (copy)`;
  let name = baseName, n = 2;
  while (profiles.some(p => p.name === name)) { name = `${baseName} ${n++}`; }
  const slug = slugify(name);
  const dup = {
    ...src,
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name, slug, adopted: false, createdAt: new Date().toISOString(),
  };
  profiles.push(dup);
  saveProfiles(profiles);
  return { ok: true, profile: dup };
});

ipcMain.handle('profiles:launch', (_e, { id }) => {
  const p = loadProfiles().find(x => x.id === id);
  if (!p) return { ok: false, error: 'not-found' };
  return launchProfile(p);
});

ipcMain.handle('profiles:menuAt', (e, { id }) => {
  const p = loadProfiles().find(x => x.id === id);
  if (!p) return;
  const isRunning = running.has(id);
  const win = BrowserWindow.fromWebContents(e.sender);
  const menu = Menu.buildFromTemplate([
    { label: isRunning ? 'Focus / relaunch' : 'Launch', click: () => launchProfile(p) },
    { label: 'Open data folder', click: () => shell.openPath(profileDir(p)) },
    { type: 'separator' },
    { label: 'Rename…', click: () => panel && panel.webContents.send('start-rename', { id }) },
    { label: 'Duplicate', click: async () => {
        // reuse the handler by calling it through same code path
        const profiles = loadProfiles();
        let baseName = `${p.name} (copy)`;
        let name = baseName, n = 2;
        while (profiles.some(x => x.name === name)) name = `${baseName} ${n++}`;
        const slug = slugify(name);
        profiles.push({
          ...p,
          id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name, slug, adopted: false, createdAt: new Date().toISOString(),
        });
        saveProfiles(profiles);
        panel && panel.webContents.send('refresh');
      } },
    { type: 'separator' },
    { label: 'Remove…', click: () => panel && panel.webContents.send('start-remove', { id }) },
  ]);
  menu.popup({ window: win });
});

ipcMain.handle('profiles:export', async () => {
  return withDialogGuard(async () => {
    const r = await dialog.showSaveDialog(panel, {
      title: 'Export Facet profiles',
      defaultPath: `facet-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      profiles: loadProfiles(),
      settings: loadUserSettings(),
    };
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2));
    log('info', 'exported', r.filePath);
    return { ok: true, path: r.filePath };
  });
});

ipcMain.handle('profiles:import', async (_e, { mode }) => {
  return withDialogGuard(async () => {
  const r = await dialog.showOpenDialog(panel, {
    title: 'Import Facet profiles',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(raw.profiles)) return { ok: false, error: 'invalid-format' };
    let target = mode === 'replace' ? [] : loadProfiles();
    const existingSlugs = new Set(target.map(p => p.slug));
    let added = 0, skipped = 0;
    for (const p of raw.profiles) {
      if (existingSlugs.has(p.slug)) { skipped++; continue; }
      target.push({
        ...p,
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${added}`,
      });
      existingSlugs.add(p.slug);
      added++;
    }
    saveProfiles(target);
    log('info', 'imported', { added, skipped, mode });
    return { ok: true, added, skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
  });
});

// ============================================================================
// Session export — Claude Code's /export, rebuilt
//
// The CLI still carries /export, but it is declared `requires: { ink: true }` — it lives only
// inside the terminal renderer, so Claude Desktop never offers it and there is no headless form
// to shell out to. tools/session-export.mjs rebuilds the archive /export wrote, for any session
// under ~/.claude/projects, which the desktop app and the CLI share.
//
// It runs on Electron's own Node via ELECTRON_RUN_AS_NODE, so Facet needs no Node install.
// ============================================================================
const SESSION_TOOL = path.join(__dirname, 'tools', 'session-export.mjs');
const SESSION_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

function runSessionTool(args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [SESSION_TOOL, ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, SESSION_TOOL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: 'the export took too long and was stopped' });
      const lastErr = err.trim().split(/\r?\n/).filter(Boolean).pop();
      if (code !== 0) return resolve({ ok: false, error: lastErr || `export tool exited ${code}` });
      // --json prints a single JSON line; take the last one in case a child wrote to stdout.
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
      try { resolve({ ok: true, data: JSON.parse(line) }); }
      catch { resolve({ ok: false, error: 'could not read the export tool output' }); }
    });
  });
}

ipcMain.handle('sessions:list', async () => {
  const r = await runSessionTool(['--list', '--all', '--json', '--cache', SESSION_LIST_CACHE_JSON]);
  if (!r.ok) { log('warn', 'session list failed', r.error); return { ok: false, error: r.error }; }
  return { ok: true, sessions: r.data };
});

ipcMain.handle('sessions:export', async (_e, { id, logsProfileId, keepLargeTasks }) => {
  return withDialogGuard(async () => {
    const short = String(id || '').slice(0, 8);
    const res = await dialog.showSaveDialog(panel, {
      title: 'Export Claude session',
      defaultPath: path.join(app.getPath('downloads'), `session-export-${short}.zip`),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const args = [String(id), '--json', '--out', res.filePath];
    // Logs sit in the Claude data dir, which is per-profile under Facet, so the caller says
    // whose logs belong with this session. No profile picked means no logs.
    const prof = logsProfileId ? loadProfiles().find((p) => p.id === logsProfileId) : null;
    if (prof) args.push('--logs-dir', path.join(profileDir(prof), 'logs'));
    else args.push('--no-logs');
    if (keepLargeTasks) args.push('--max-task', '0');

    const r = await runSessionTool(args);
    if (!r.ok) {
      log('warn', 'session export failed', { id, error: r.error });
      return { ok: false, error: r.error };
    }
    log('info', 'session exported', { id, out: r.data.out, bytes: r.data.bytes });
    return { ok: true, ...r.data };
  });
});

ipcMain.handle('sessions:reveal', (_e, { pathToShow }) => shell.showItemInFolder(pathToShow));

// The picker asks for a link that arrived before the panel was listening.
ipcMain.handle('links:pending', () => ({ url: pendingLink }));

ipcMain.handle('links:open', (_e, { id, url }) => {
  const p = loadProfiles().find((x) => x.id === id);
  if (!p) return { ok: false, error: 'not-found' };
  pendingLink = null;
  return launchProfile(p, false, [url]);
});

ipcMain.handle('links:cancel', () => { pendingLink = null; return { ok: true }; });

ipcMain.handle('links:status', () => ({ handling: facetHandlesLinks(), command: currentLinkCommand() }));

ipcMain.handle('panel:hide', () => { if (panel) panel.hide(); });

ipcMain.handle('panel:resize', (_e, { height }) => {
  if (!panel) return;
  const [w] = panel.getSize();
  const anchor = tray && tray.getBounds();
  const display = anchor && anchor.width
    ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
    : screen.getPrimaryDisplay();
  const maxH = Math.max(320, Math.min(940, display.workArea.height - 48));
  const target = Math.max(240, Math.min(maxH, Math.round(height)));
  // A window created with resizable:false keeps its current size as its minimum on Windows, so
  // setSize could only ever make the panel taller. Once a tall view had been opened the panel
  // stayed that tall, ran past the bottom of the screen, and cut off whatever sat at its foot.
  panel.setMinimumSize(w, 240);
  panel.setSize(w, target, false);
  if (tray) positionPanel(tray.getBounds());
});

ipcMain.handle('shell:open', (_e, { pathToOpen }) => shell.openPath(pathToOpen));

ipcMain.handle('app:quit', () => attemptQuit());
