const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

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
const CLAUDE_DATA_DIR = path.join(app.getPath('appData'), 'Claude');
const CLAUDE_MSIX_PACKAGE_FAMILY = 'Claude_pzs8sxrjxfjjc';

const CLAUDE_EXE_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude-desktop', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude', 'Claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe'),
];

const DEFAULT_SETTINGS = {
  customClaudePath: null,
  launchAtLogin: false,
  globalHotkey: 'Control+Alt+C',
  confirmOnQuit: true,
  onboardingComplete: false,
};

let tray = null;
let panel = null;
let currentHotkey = null;
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
function listOrphanSlugs() {
  const dir = path.join(PROFILE_ROOT, 'profiles');
  if (!fs.existsSync(dir)) return [];
  const claimed = new Set(loadProfiles().filter(p => !p.adopted).map(p => p.slug));
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return items
    .filter(d => d.isDirectory() && !claimed.has(d.name))
    .map(d => {
      const full = path.join(dir, d.name);
      let mtime = null, size = 0, hasSession = false;
      try {
        mtime = fs.statSync(full).mtime.toISOString();
        // Session markers: presence of Local Storage or IndexedDB means a real signed-in dir
        hasSession = fs.existsSync(path.join(full, 'Local Storage')) ||
                     fs.existsSync(path.join(full, 'IndexedDB'));
        size = folderSize(full);
      } catch {}
      return { slug: d.name, path: full, mtime, size, hasSession };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
}

function folderSize(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    let items;
    try { items = fs.readdirSync(p, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const full = path.join(p, it.name);
      if (it.isDirectory()) stack.push(full);
      else {
        try { total += fs.statSync(full).size; } catch {}
      }
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
// Claude.exe detection with a small cache + health check
// ============================================================================
let claudeExeCache = { done: false, path: null, source: null };

function findClaudeExe() {
  if (claudeExeCache.done) return claudeExeCache.path;
  const settings = loadSettings();
  if (settings.customClaudePath) {
    if (fs.existsSync(settings.customClaudePath)) {
      claudeExeCache = { done: true, path: settings.customClaudePath, source: 'custom' };
      return settings.customClaudePath;
    } else {
      // Custom path has become invalid — clear it and fall through to auto-detect
      log('warn', 'customClaudePath no longer exists, clearing:', settings.customClaudePath);
      const user = loadUserSettings();
      delete user.customClaudePath;
      saveUserSettings(user);
    }
  }
  for (const p of CLAUDE_EXE_CANDIDATES) {
    if (p && fs.existsSync(p)) {
      claudeExeCache = { done: true, path: p, source: 'installer' };
      return p;
    }
  }
  const msix = findMsixClaudeExe();
  claudeExeCache = { done: true, path: msix, source: msix ? 'msix' : null };
  return msix;
}

function findMsixClaudeExe() {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive',
      '-Command',
      `Get-AppxPackage | Where-Object PackageFamilyName -eq ${CLAUDE_MSIX_PACKAGE_FAMILY} | Select-Object -ExpandProperty InstallLocation`,
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    if (!out) return null;
    const exe = path.join(out, 'app', 'Claude.exe');
    return fs.existsSync(exe) ? exe : null;
  } catch (e) {
    log('warn', 'MSIX detection failed', e.message);
    return null;
  }
}

function invalidateClaudeExeCache() {
  claudeExeCache = { done: false, path: null, source: null };
}

function detectAdoptable() {
  return fs.existsSync(CLAUDE_DATA_DIR);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lane';
}

function profileDir(profile) {
  if (profile.adopted) return CLAUDE_DATA_DIR;
  return path.join(PROFILE_ROOT, 'profiles', profile.slug);
}

function launchProfile(profile) {
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
  try {
    const child = spawn(exe, [`--user-data-dir=${dir}`], {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    running.add(profile.id);
    child.on('exit', () => {
      running.delete(profile.id);
      broadcastRunning();
    });
    broadcastRunning();
    log('info', 'launched', { id: profile.id, name: profile.name, adopted: !!profile.adopted, dir });
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
  panel.loadFile(path.join(__dirname, 'ui', 'panel.html'));
  panel.on('blur', () => { if (panel && panel.isVisible()) panel.hide(); });
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
    { label: 'Open data folder', click: () => shell.openPath(PROFILE_ROOT) },
    { label: 'Settings', click: () => {
        togglePanel(tray.getBounds());
        if (panel && !panel.isDestroyed()) panel.webContents.send('goto-view', 'settings');
      } },
    { label: 'About Facet', click: () => dialog.showMessageBox({
        type: 'info',
        title: 'Facet',
        message: 'Facet — one identity, many facets',
        detail: `Version 0.1.0\n\nLaunches Claude Desktop with a per-profile --user-data-dir.\nNo network. No token handling. Data stays local.\n\nProfiles: ${PROFILE_ROOT}\nPortable: ${IS_PORTABLE ? 'yes' : 'no'}`,
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
app.on('second-instance', () => {
  if (panel) togglePanel(tray && tray.getBounds());
});

app.whenReady().then(() => {
  ensureRoot();
  log('info', 'Facet starting', { portable: IS_PORTABLE, root: PROFILE_ROOT });
  const image = createTrayIcon();
  tray = new Tray(image);
  tray.setToolTip('Facet — Claude profiles');
  tray.setContextMenu(buildContextMenu());
  createPanel();
  tray.on('click', () => togglePanel(tray.getBounds()));
  syncLaunchAtLogin();
  syncGlobalHotkey();
});

app.on('window-all-closed', (e) => { if (!isQuitting) e.preventDefault(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });

// ============================================================================
// IPC — panel/renderer surface
// ============================================================================
ipcMain.handle('profiles:list', () => {
  invalidateClaudeExeCache();
  const { effective, locked } = getEffectiveSettings();
  const orphans = listOrphanSlugs();
  return {
    profiles: loadProfiles(),
    running: Array.from(running),
    claudeExe: findClaudeExe(),
    claudeExeSource: claudeExeCache.source,
    adoptable: detectAdoptable(),
    paths: { root: PROFILE_ROOT, claudeData: CLAUDE_DATA_DIR },
    settings: effective,
    lockedSettings: locked,
    portable: IS_PORTABLE,
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
  const { effective, locked } = getEffectiveSettings();
  return { settings: effective, locked };
});

ipcMain.handle('settings:pickClaudeExe', async () => {
  const r = await dialog.showOpenDialog({
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

ipcMain.handle('profiles:recoverOrphan', (_e, { slug, name, color }) => {
  const orphans = listOrphanSlugs();
  if (!orphans.some(o => o.slug === slug)) return { ok: false, error: 'not-orphan' };
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
  const r = await dialog.showSaveDialog({
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

ipcMain.handle('profiles:import', async (_e, { mode }) => {
  const r = await dialog.showOpenDialog({
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

ipcMain.handle('panel:hide', () => { if (panel) panel.hide(); });

ipcMain.handle('panel:resize', (_e, { height }) => {
  if (!panel) return;
  const [w] = panel.getSize();
  const anchor = tray && tray.getBounds();
  const display = anchor && anchor.width
    ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
    : screen.getPrimaryDisplay();
  const maxH = Math.max(320, Math.min(940, display.workArea.height - 48));
  panel.setSize(w, Math.max(240, Math.min(maxH, Math.round(height))), false);
  if (tray) positionPanel(tray.getBounds());
});

ipcMain.handle('shell:open', (_e, { pathToOpen }) => shell.openPath(pathToOpen));

ipcMain.handle('app:quit', () => attemptQuit());
