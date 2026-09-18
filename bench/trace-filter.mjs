#!/usr/bin/env node
// Chromium trace of one filter keystroke in the sessions view: how much is script, style, layout.
//   node bench/trace-filter.mjs --label 0.1.2
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, ROOT, RESULTS_DIR, sessionsHome, profilesData } from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const LABEL = argv[argv.indexOf('--label') + 1] || JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const APP = path.join(ROOT, `app-${LABEL}`);
const LIVE = path.join(APP, 'FacetData');
const src = profilesData('typical', 'stub');
fs.rmSync(LIVE, { recursive: true, force: true });
fs.renameSync(src, LIVE);
const child = spawn(path.join(APP, 'Facet.exe'), ['--portable', `--user-data-dir=${path.join(ROOT, `udd-${LABEL}`)}`, '--remote-debugging-port=9881', '--inspect=9882'], { stdio: 'ignore' });
try {
  const page = await CDP.connect((await waitForTarget(9881, (t) => t.type === 'page')).webSocketDebuggerUrl);
  const main = await CDP.connect((await waitForTarget(9882, () => true)).webSocketDebuggerUrl);
  while (!(await page.eval('!!document.querySelector(".panel")').catch(() => false))) await sleep(50);
  await main.eval(`process.env.USERPROFILE = ${JSON.stringify(sessionsHome('large'))}; 1`);
  await page.eval("(async () => { state.view='sessions'; await loadSessions(true); })()");
  // the exact code path a keystroke takes
  const keystroke = `(() => { const i = document.getElementById('ses-q'); i.value = 'p'; i.dispatchEvent(new Event('input', { bubbles: true })); void document.body.offsetHeight; })()`;
  await page.eval(keystroke);
  const events = [];
  page.on('Tracing.dataCollected', (p) => events.push(...p.value));
  const done = new Promise((r) => page.on('Tracing.tracingComplete', r));
  await page.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
  const t0 = await page.eval('performance.now()');
  await page.eval(keystroke.replace("'p'", "'pr'"));
  const wall = (await page.eval('performance.now()')) - t0;
  await page.send('Tracing.end');
  await done;
  const byName = {};
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    byName[e.name] = (byName[e.name] || 0) + e.dur / 1000;
  }
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, ms]) => ({ name, ms: +ms.toFixed(1) }));
  const out = { label: LABEL, keystrokeWallMs: +wall.toFixed(1), topEventsMs: top };
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `trace-filter-${LABEL}.json`), JSON.stringify(out, null, 2));
} finally {
  killTree(child.pid);
  await sleep(500);
  fs.renameSync(LIVE, src);
}
