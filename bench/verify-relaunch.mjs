#!/usr/bin/env node
// Claude Desktop from the Microsoft Store lives in a folder named after its version, so every
// update moves it. Facet remembers where it was. This checks what a click does after that move:
// it must re-detect and launch, never leave the profile showing as running.
//
//   node bench/verify-relaunch.mjs [--label 0.2.1]
//
// Both the "old" and the "new" Claude here are stubs inside a sandboxed LOCALAPPDATA, so nothing
// real is started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STUB_EXE } from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const LABEL = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : '0.2.1';
const APP = path.join(ROOT, `app-${LABEL}`);
const DATA = path.join(APP, 'FacetData');
const SB = path.join(ROOT, 'relaunch-sandbox');
const PORT = 9917;

if (!fs.existsSync(STUB_EXE) || fs.statSync(STUB_EXE).size < 1024) {
  // the stub must be a real executable that starts and exits; node.exe does both
  fs.mkdirSync(path.dirname(STUB_EXE), { recursive: true });
  fs.copyFileSync(process.execPath, STUB_EXE);
}
fs.rmSync(SB, { recursive: true, force: true });
const OLD = path.join(SB, 'Claude_2.2553.13.0', 'Claude.exe');  // where Facet last saw Claude
const NEW = path.join(SB, 'AnthropicClaude', 'Claude.exe');     // where the update put it
for (const p of [OLD, NEW]) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.copyFileSync(STUB_EXE, p);
}
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'facet.json'), JSON.stringify({ profiles: [{ id: 'a', name: 'Work', slug: 'work', adopted: false }] }));
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ onboardingComplete: true, globalHotkey: '', customClaudePath: OLD }));

const child = spawn(path.join(APP, 'Facet.exe'),
  ['--portable', `--user-data-dir=${path.join(ROOT, 'udd-relaunch')}`, `--remote-debugging-port=${PORT}`],
  { env: { ...process.env, LOCALAPPDATA: SB }, stdio: 'ignore' });
let bad = 0;
const check = (ok, what, detail) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); };
try {
  const page = await CDP.connect((await waitForTarget(PORT, (t) => t.type === 'page', 45000)).webSocketDebuggerUrl);
  while ((await page.eval('document.querySelectorAll(".lane").length').catch(() => 0)) !== 1) await sleep(100);
  await page.eval("(() => { globalThis.__ev = []; facet.onRunningChanged((l) => globalThis.__ev.push(l.length ? 'running' : 'idle')); return 1; })()");
  check((await page.eval('state.claudeExe')) === OLD, 'Facet starts out pointing at the old folder');

  fs.rmSync(path.dirname(OLD), { recursive: true, force: true });   // the update deletes it
  await page.eval("facet.launch({ id: 'a' })");
  await sleep(3000);

  const events = JSON.parse(await page.eval('JSON.stringify(globalThis.__ev)'));
  const log = fs.readdirSync(path.join(DATA, 'logs')).map((f) => fs.readFileSync(path.join(DATA, 'logs', f), 'utf8')).join('');
  check(/claude moved, re-detecting/.test(log), 'notices that Claude moved');
  check(/\[info\] launched/.test(log), 'launches it at the new location');
  check(events[0] === 'running' && events[events.length - 1] === 'idle', 'the profile stops showing as running when Claude exits', events.join(' -> ') || 'no state change');
  check(!(await page.eval('!!document.querySelector(".status-dot")')), 'no stuck green dot');
  check(!/uncaught/.test(log), 'no uncaught error', (log.match(/uncaught.*/) || [''])[0].slice(0, 80));
} finally {
  killTree(child.pid);
  await sleep(500);
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(SB, { recursive: true, force: true });
}
console.log(bad ? `\nFAILED — ${bad} check(s)` : '\na Claude update no longer breaks launching');
process.exit(bad ? 1 : 0);
