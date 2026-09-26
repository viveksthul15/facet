#!/usr/bin/env node
// Does the build that was just produced actually start? Runs the packaged exe in portable mode
// with an empty data folder — a first run on a clean machine — and checks the panel renders.
// Used by CI before anything is published; safe to run locally too.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
const APP = process.argv[2] || path.join(REPO, 'dist', 'win-unpacked');
const EXE = path.join(APP, 'Facet.exe');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-smoke-'));
const DATA = path.join(APP, 'FacetData');

if (!fs.existsSync(EXE)) {
  console.error(`no packaged build at ${EXE} — run npm run build first`);
  process.exit(1);
}
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ globalHotkey: '' })); // don't grab the user's hotkey

const child = spawn(EXE, ['--portable', `--user-data-dir=${path.join(WORK, 'udd')}`, '--remote-debugging-port=9921'], { stdio: 'ignore' });
let bad = 0;
const check = (ok, what, detail) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); };
try {
  const target = await waitForTarget(9921, (t) => t.type === 'page' && /panel\.html$/.test(t.url), 60000);
  const page = await CDP.connect(target.webSocketDebuggerUrl);
  const until = Date.now() + 30000;
  let panel = false;
  while (Date.now() < until && !panel) { panel = await page.eval('!!document.querySelector(".panel")').catch(() => false); await sleep(100); }
  check(panel, 'the panel renders on a first run');
  check(!!(await page.eval('!!document.querySelector(".empty, .lane-list, .panel-body")')), 'it shows a first-run state');
  check((await page.eval('state.version')) === JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version,
    'the build reports the version in package.json', await page.eval('state.version'));
  const errors = await page.eval('JSON.stringify(globalThis.__errs || [])');
  check(errors === '[]', 'no renderer errors', errors);
  check(!fs.existsSync(path.join(DATA, 'startup.log')), 'no startup failure was recorded',
    fs.existsSync(path.join(DATA, 'startup.log')) ? fs.readFileSync(path.join(DATA, 'startup.log'), 'utf8').slice(0, 200) : '');
} finally {
  killTree(child.pid);
  await sleep(400);
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(WORK, { recursive: true, force: true });
}
console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nthe packaged build starts cleanly');
process.exit(bad ? 1 : 0);
