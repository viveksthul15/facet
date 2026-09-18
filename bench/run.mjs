#!/usr/bin/env node
// Facet benchmark suite — drives the PACKAGED app (win-unpacked, exactly what the installer lays
// down) over the DevTools protocol. No app code is modified or instrumented.
//
//   node bench/gen-data.mjs
//   node bench/run.mjs --label 0.1.2                      full suite
//   node bench/run.mjs --label 0.1.2 --only cold,export   some suites (merged into the results file)
//   node bench/run.mjs --label 0.2.0 --app dist/win-unpacked
//
// Results: bench/results/results-<label>.json (+ .md via bench/report.mjs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO, ROOT, RESULTS_DIR, PROFILE_TIERS, SESSION_TIERS, EXPORT_TARGETS, sessionsHome, profilesData,
} from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { machineInfo, loadSnapshot, treeStats, killTree, stats } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LABEL = opt('--label', JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
const SRC_APP = path.resolve(REPO, opt('--app', 'dist/win-unpacked'));
const ONLY = opt('--only', 'sizes,cold,actions,sessions,export,memory').split(',');
const RUNS = Number(opt('--runs', '5'));

const APP_DIR = path.join(ROOT, `app-${LABEL}`);
const EXE = path.join(APP_DIR, 'Facet.exe');
const LIVE_DATA = path.join(APP_DIR, 'FacetData');
const UDD = path.join(ROOT, `udd-${LABEL}`);
const OUT_DIR = path.join(ROOT, 'out');
const RESULT_FILE = path.join(RESULTS_DIR, `results-${LABEL}.json`);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── app copy + data swapping ────────────────────────────────────────────────
function prepareApp() {
  if (!fs.existsSync(EXE)) {
    log(`copying ${SRC_APP} -> ${APP_DIR}`);
    fs.cpSync(SRC_APP, APP_DIR, { recursive: true });
  }
  restoreData();
  fs.mkdirSync(OUT_DIR, { recursive: true });
}
// FacetData for a scenario is renamed into place next to the exe (portable mode) and renamed
// back afterwards — instant on one volume, and a 75k-file tier is generated only once.
function restoreData() {
  const origin = path.join(LIVE_DATA, '.origin');
  if (fs.existsSync(origin)) fs.renameSync(LIVE_DATA, fs.readFileSync(origin, 'utf8'));
  else if (fs.existsSync(LIVE_DATA)) fs.rmSync(LIVE_DATA, { recursive: true, force: true });
}
function installData(tier, mode) {
  restoreData();
  const src = profilesData(tier, mode);
  if (!fs.existsSync(src)) throw new Error(`missing ${src} — run bench/gen-data.mjs`);
  fs.rmSync(path.join(src, 'logs'), { recursive: true, force: true });
  fs.renameSync(src, LIVE_DATA);
  fs.writeFileSync(path.join(LIVE_DATA, '.origin'), src);
}

// ── launching ───────────────────────────────────────────────────────────────
let portSeq = 9300 + Math.floor(Math.random() * 300);
async function launch({ tier = 'typical', mode = 'stub', sessions = null, inspect = false } = {}) {
  if (sessions) inspect = true;
  installData(tier, mode);
  const port = ++portSeq;
  const inspectPort = ++portSeq;
  const args = ['--portable', `--user-data-dir=${UDD}`, `--remote-debugging-port=${port}`];
  if (inspect) args.push(`--inspect=${inspectPort}`);
  const env = { ...process.env };
  const spawnEpoch = Date.now();
  const t0 = performance.now();
  const child = spawn(EXE, args, { env, stdio: 'ignore', windowsHide: true });
  const expectLanes = PROFILE_TIERS[tier].profiles;
  const target = await waitForTarget(port, (t) => t.type === 'page' && /panel\.html$/.test(t.url));
  const page = await CDP.connect(target.webSocketDebuggerUrl);
  let contentMs = null, timeOrigin = null;
  while (performance.now() - t0 < 60000) {
    let v;
    try { v = await page.eval('[document.querySelectorAll(".lane").length, performance.timeOrigin]'); } catch { v = null; }
    if (v && v[0] === expectLanes) { contentMs = performance.now() - t0; timeOrigin = v[1]; break; }
    await sleep(4);
  }
  if (contentMs == null) { killTree(child.pid); restoreData(); throw new Error('panel never showed its profiles'); }
  let main = null;
  if (inspect) {
    const mt = await waitForTarget(inspectPort, () => true).catch((e) => { killTree(child.pid); restoreData(); throw e; });
    main = await CDP.connect(mt.webSocketDebuggerUrl);
    // Electron will not start under a substitute USERPROFILE, so the generated session store is
    // swapped in afterwards: Facet builds the export tool's env from process.env at call time.
    if (sessions) await main.eval(`process.env.USERPROFILE = ${JSON.stringify(sessionsHome(sessions))}; 1`);
  }
  // main-process "ready" comes from Facet's own log line, written in app.whenReady()
  let readyMs = null;
  try {
    const dir = path.join(LIVE_DATA, 'logs');
    const txt = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const m = [...txt.matchAll(/^(\S+) \[info\] Facet starting/gm)].pop();
    if (m) readyMs = Date.parse(m[1]) - spawnEpoch;
  } catch {}
  return {
    child, page, main, contentMs, readyMs, navStartMs: timeOrigin - spawnEpoch,
    async close() { page.close(); main?.close(); killTree(child.pid); await sleep(400); restoreData(); },
  };
}

// time an (async) expression inside the renderer, n times
async function timeIn(page, expr, n, { setup = '' } = {}) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    xs.push(await page.eval(`(async () => { ${setup}; const __t = performance.now(); ${expr}; return performance.now() - __t; })()`));
  }
  return stats(xs);
}
const LAYOUT = 'void document.body.offsetHeight';

// ── suites ──────────────────────────────────────────────────────────────────
function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}
function suiteSizes() {
  const mb = (n) => +(n / 2 ** 20).toFixed(2);
  const dist = path.dirname(SRC_APP);
  const f = (name) => { const p = path.join(dist, name); return fs.existsSync(p) ? mb(fs.statSync(p).size) : null; };
  return {
    installerMB: f(`Facet-Setup-${LABEL}.exe`), portableMB: f(`Facet-Portable-${LABEL}.exe`),
    installedMB: mb(dirSize(SRC_APP)), appAsarKB: +(fs.statSync(path.join(SRC_APP, 'resources', 'app.asar')).size / 1024).toFixed(1),
  };
}

const COLD_SCENARIOS = [
  ...Object.keys(PROFILE_TIERS).map((tier) => ({ tier, mode: 'stub' })),
  { tier: 'typical', mode: 'detect' },
];

async function suiteCold() {
  const out = {};
  for (const sc of COLD_SCENARIOS) {
    const key = `${sc.tier}/${sc.mode}`;
    const content = [], ready = [], nav = [];
    for (let i = -1; i < RUNS; i++) { // run -1 is a discarded warm-up
      const app = await launch(sc);
      if (i >= 0) { content.push(app.contentMs); if (app.readyMs != null) ready.push(app.readyMs); nav.push(app.navStartMs); }
      await app.close();
    }
    out[key] = { firstContentMs: stats(content), mainReadyMs: ready.length ? stats(ready) : null, rendererNavStartMs: stats(nav) };
    log(`cold ${key}: ${out[key].firstContentMs.median} ms (${out[key].firstContentMs.min}–${out[key].firstContentMs.max})`);
  }
  return out;
}

async function suiteActions() {
  const out = {};
  for (const sc of COLD_SCENARIOS) {
    const key = `${sc.tier}/${sc.mode}`;
    const n = sc.mode === 'detect' ? 5 : 10;
    const app = await launch(sc);
    const p = app.page;
    const r = {};
    r.listIpcMs = await timeIn(p, 'await facet.list()', n);
    r.refreshAndRenderMs = await timeIn(p, `await refresh(); render(); ${LAYOUT}`, n);
    r.renderProfilesMs = await timeIn(p, `render(); ${LAYOUT}`, n, { setup: "state.view='populated'" });
    r.openManageMs = await timeIn(p, `setView('manage'); ${LAYOUT}`, n, { setup: "state.view='populated'" });
    r.openSettingsMs = await timeIn(p, `setView('settings'); ${LAYOUT}`, n, { setup: "state.view='populated'" });
    await p.eval("setView('manage')");
    if (PROFILE_TIERS[sc.tier].profiles > 1) {
      // down then up, so the store ends as it started
      r.reorderMs = await timeIn(p, `await onReorder(state.profiles[0], 'down'); await onReorder(state.profiles[1], 'up'); ${LAYOUT}`, Math.ceil(n / 2));
      r.reorderMs.note = 'two moves (down + up) per run';
    }
    r.renameMs = await timeIn(p, `const pr = state.profiles[0], old = pr.name; await api.rename({id: pr.id, name: old + ' x'}); await refresh(); render(); ${LAYOUT}; await api.rename({id: pr.id, name: old}); await refresh(); render(); ${LAYOUT}`, Math.ceil(n / 2));
    r.renameMs.note = 'two renames per run';
    r.preflightKeystrokeMs = await timeIn(p, "await facet.preflight({ name: 'Brand new profile', adopted: false })", n);
    r.listOrphansMs = await timeIn(p, 'await facet.listOrphans()', n);
    out[key] = r;
    log(`actions ${key}: list ${r.listIpcMs.median} ms, refresh+render ${r.refreshAndRenderMs.median} ms, orphans ${r.listOrphansMs.median} ms`);
    await app.close();
  }
  return out;
}

async function suiteSessions() {
  const out = {};
  for (const tier of Object.keys(SESSION_TIERS)) {
    const app = await launch({ tier: 'typical', mode: 'stub', sessions: tier });
    const p = app.page;
    const r = {};
    r.openSessionsViewMs = await timeIn(p, `await loadSessions(true); ${LAYOUT}`, RUNS, { setup: "state.view='sessions'; state.sessions.rows=[]; state.sessions.loading=false" });
    r.rows = await p.eval('state.sessions.rows.length');
    r.payloadKB = +((await p.eval('JSON.stringify(state.sessions.rows).length')) / 1024).toFixed(1);
    r.renderListMs = await timeIn(p, `render(); ${LAYOUT}`, 10, { setup: "state.sessions.query=''" });
    // typing "proj-01" one character at a time — every keystroke re-renders the list
    const keys = [];
    for (const q of ['p', 'pr', 'pro', 'proj', 'proj-', 'proj-0', 'proj-01']) {
      keys.push((await timeIn(p, `render(); ${LAYOUT}`, 5, { setup: `state.sessions.query=${JSON.stringify(q)}` })).median);
    }
    r.filterKeystrokeMs = stats(keys);
    await p.eval("state.sessions.query=''; render()");
    await sleep(1500);
    r.memoryAfterList = treeStats(app.child.pid);
    out[tier] = r;
    log(`sessions ${tier}: ${r.rows} rows, open ${r.openSessionsViewMs.median} ms, keystroke ${r.filterKeystrokeMs.median} ms`);
    await app.close();
  }
  return out;
}

async function suiteExport() {
  const out = {};
  const app = await launch({ tier: 'typical', mode: 'stub', sessions: 'typical', inspect: true });
  // The save dialog cannot be scripted, so the harness answers it from the main-process inspector.
  const setOut = (file) => app.main.eval(
    `process.mainModule.require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(file)} }); 1`);
  for (const tg of EXPORT_TARGETS) {
    const file = path.join(OUT_DIR, `export-${tg.key}.zip`);
    await setOut(file);
    const times = [];
    let zipBytes = null, turns = null;
    const n = tg.bytes >= 50 * 2 ** 20 ? 3 : RUNS;
    for (let i = 0; i < n; i++) {
      fs.rmSync(file, { force: true });
      const res = await app.page.eval(`(async () => { const t = performance.now(); const r = await facet.exportSession({ id: ${JSON.stringify(tg.id)}, logsProfileId: null, keepLargeTasks: false }); return { ms: performance.now() - t, r }; })()`);
      if (!res.r.ok) throw new Error(`export ${tg.key} failed: ${res.r.error}`);
      times.push(res.ms); zipBytes = res.r.bytes; turns = res.r.turns;
    }
    fs.rmSync(file, { force: true });
    out[tg.key] = { exportMs: stats(times), zipMB: +(zipBytes / 2 ** 20).toFixed(2), turns };
    log(`export ${tg.key}: ${out[tg.key].exportMs.median} ms -> ${out[tg.key].zipMB} MB zip`);
  }
  await app.close();
  return out;
}

async function suiteMemory() {
  const app = await launch({ tier: 'typical', mode: 'stub' });
  await sleep(10000);
  const a = treeStats(app.child.pid);
  await sleep(30000);
  const b = treeStats(app.child.pid);
  await app.close();
  const r = { idle: a, idleCpuPctOfOneCore: +(((b.cpuMs - a.cpuMs) / 30000) * 100).toFixed(2), idleWindowSec: 30 };
  log(`memory: ${a.processes} procs, WS ${a.workingSetMB} MB, private ${a.privateMB} MB, idle CPU ${r.idleCpuPctOfOneCore}%`);
  return r;
}

// ── main ────────────────────────────────────────────────────────────────────
prepareApp();
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const results = fs.existsSync(RESULT_FILE) ? JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')) : { label: LABEL, suites: {}, environment: {} };
results.machine = machineInfo();
results.electron = (() => { try { return fs.readFileSync(path.join(APP_DIR, 'version'), 'utf8').trim(); } catch { return null; } })();
results.method = { coldStartRuns: RUNS, warmupRunsDiscarded: 1, build: 'packaged win-unpacked, portable mode, driven over DevTools protocol' };
const SUITES = { sizes: suiteSizes, cold: suiteCold, actions: suiteActions, sessions: suiteSessions, export: suiteExport, memory: suiteMemory };
const save = () => fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
process.on('SIGINT', () => { restoreData(); process.exit(130); });
try {
  for (const name of Object.keys(SUITES)) {
    if (!ONLY.includes(name)) continue;
    const before = name === 'sizes' ? null : loadSnapshot();
    log(`── ${name}${before ? ` (free RAM ${before.freeRamGB} GB, CPU load ${before.cpuLoadPct}%)` : ''}`);
    results.suites[name] = await SUITES[name]();
    if (before) results.environment[name] = { before, after: loadSnapshot(), power: machineInfo().power };
    results.suites[name].__ranAt = new Date().toISOString();
    save();
  }
} finally {
  restoreData();
}
log(`saved ${path.relative(REPO, RESULT_FILE)}`);
