#!/usr/bin/env node
// CPU-profile the hot paths inside the packaged app and print where the time goes (line level).
//   node bench/profile.mjs --label 0.1.2
// Writes bench/results/profile-<label>.json. Raw .cpuprofile files stay under FACET_BENCH_ROOT.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, ROOT, RESULTS_DIR, EXPORT_TARGETS, sessionsHome, profilesData } from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LABEL = opt('--label', JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
const APP_DIR = path.join(ROOT, `app-${LABEL}`);
const EXE = path.join(APP_DIR, 'Facet.exe');
const LIVE = path.join(APP_DIR, 'FacetData');
const PROF_DIR = path.join(ROOT, `prof-${LABEL}`);
fs.mkdirSync(PROF_DIR, { recursive: true });

/** Self time per function and per line, from a V8 .cpuprofile. */
function summarize(profile, top = 12) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    total += dt;
    self.set(id, (self.get(id) || 0) + dt);
  });
  const fn = new Map(), line = new Map();
  for (const [id, t] of self) {
    const n = byId.get(id), cf = n.callFrame;
    const file = cf.url ? cf.url.split(/[\\/]/).slice(-1)[0] : '(native)';
    const k = `${cf.functionName || '(anonymous)'} ${file}:${cf.lineNumber + 1}`;
    fn.set(k, (fn.get(k) || 0) + t);
    const ticks = n.positionTicks || [];
    const tickTotal = ticks.reduce((s, p) => s + p.ticks, 0) || 1;
    for (const p of ticks) { const lk = `${file}:${p.line}`; line.set(lk, (line.get(lk) || 0) + (t * p.ticks) / tickTotal); }
  }
  const rank = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, t]) => ({ where: k, ms: +t.toFixed(1), pct: +((t / total) * 100).toFixed(1) }));
  return { totalMs: +total.toFixed(1), topFunctions: rank(fn), topLines: rank(line).filter((l) => !l.where.startsWith('(native)')) };
}

async function profiled(client, run) {
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 200 });
  await client.send('Profiler.start');
  await run();
  return (await client.send('Profiler.stop')).profile;
}

async function withApp({ tier, sessions }, fn) {
  const src = profilesData(tier, 'stub');
  fs.rmSync(LIVE, { recursive: true, force: true });
  fs.renameSync(src, LIVE);
  const child = spawn(EXE, ['--portable', `--user-data-dir=${path.join(ROOT, `udd-${LABEL}`)}`, '--remote-debugging-port=9871', '--inspect=9872'], { stdio: 'ignore' });
  try {
    const page = await CDP.connect((await waitForTarget(9871, (t) => t.type === 'page')).webSocketDebuggerUrl);
    const main = await CDP.connect((await waitForTarget(9872, () => true)).webSocketDebuggerUrl);
    while (!(await page.eval('!!document.querySelector(".panel")').catch(() => false))) await sleep(50);
    if (sessions) await main.eval(`process.env.USERPROFILE = ${JSON.stringify(sessionsHome(sessions))}; 1`);
    return await fn(page, main);
  } finally {
    killTree(child.pid);
    await sleep(500);
    fs.renameSync(LIVE, src);
  }
}

/** Run the export tool the way Facet does (Electron as Node, script inside app.asar) under --cpu-prof. */
function profileTool(name, sessions, args) {
  const dir = path.join(PROF_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const tool = path.join(APP_DIR, 'resources', 'app.asar', 'tools', 'session-export.mjs');
  const t = performance.now();
  const r = spawnSync(EXE, ['--cpu-prof', `--cpu-prof-dir=${dir}`, '--cpu-prof-interval=200', tool, ...args],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: sessionsHome(sessions) }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`tool failed: ${r.stderr}`);
  const wallMs = +(performance.now() - t).toFixed(0);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  return { wallMs, ...summarize(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) };
}

const out = { label: LABEL, at: new Date().toISOString() };

out.mainProcess_profilesList_largeTier = await withApp({ tier: 'large' }, async (page, main) =>
  summarize(await profiled(main, () => page.eval('facet.list()'))));
console.log('main / profiles:list', JSON.stringify(out.mainProcess_profilesList_largeTier.topFunctions.slice(0, 5)));

out.renderer_filterKeystroke_largeStore = await withApp({ tier: 'typical', sessions: 'large' }, async (page) => {
  await page.eval("(async () => { state.view='sessions'; await loadSessions(true); })()");
  return summarize(await profiled(page, () => page.eval("for (const q of ['p','pr','pro','proj','proj-','proj-0','proj-01','']) { state.sessions.query=q; render(); void document.body.offsetHeight; }")));
});
console.log('renderer / filter', JSON.stringify(out.renderer_filterKeystroke_largeStore.topFunctions.slice(0, 5)));

out.tool_list_largeStore = profileTool('list', 'large', ['--list', '--all', '--json']);
console.log('tool / list', out.tool_list_largeStore.wallMs, JSON.stringify(out.tool_list_largeStore.topFunctions.slice(0, 5)));

const zip = path.join(ROOT, 'out', 'profile-export.zip');
out.tool_export_50MB = profileTool('export', 'typical', [EXPORT_TARGETS.find((t) => t.key === '50MB').id, '--json', '--no-logs', '--out', zip]);
fs.rmSync(zip, { force: true });
console.log('tool / export', out.tool_export_50MB.wallMs, JSON.stringify(out.tool_export_50MB.topFunctions.slice(0, 5)));

fs.writeFileSync(path.join(RESULTS_DIR, `profile-${LABEL}.json`), JSON.stringify(out, null, 2));
