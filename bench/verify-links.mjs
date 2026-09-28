#!/usr/bin/env node
// A claude:// link from the web ("Open desktop app") names no account, so Facet asks which profile
// to open it in and passes it on. This drives the packaged app with such a link and checks the
// picker appears and the chosen profile is the one that gets the link.
//
// The registry plumbing is exercised on a scratch key of our own — never on the real claude://
// association, which only the user's own setting may touch.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STUB_EXE } from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const LABEL = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : '0.2.1';
const APP = path.join(ROOT, `app-${LABEL}`);
const DATA = path.join(APP, 'FacetData');
const LINK = 'claude://claude.ai/new?mcp_auth_source=settings_connect&server=0000-test&step=success';
const PORT = 9923;

let bad = 0;
const check = (ok, what, detail) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); };

// ── claiming and handing back a protocol, on a key of our own ──────────────
const KEY = ['HKCU', 'Software', 'Classes', 'facet-selftest-protocol'].join('\\');
const CMD = `${KEY}\\shell\\open\\command`;
const reg = (...args) => execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
const readDefault = (key) => (reg('query', key, '/ve').match(/REG_SZ\s+(.*)/) || [])[1]?.trim() ?? null;
const OLD = '"C:\\old\\Claude.exe" "%1"';
const NEW = '"C:\\new\\Facet.exe" "%1"';
try {
  reg('add', CMD, '/ve', '/t', 'REG_SZ', '/d', OLD, '/f');
  const before = readDefault(CMD);
  reg('add', CMD, '/ve', '/t', 'REG_SZ', '/d', NEW, '/f');
  const after = readDefault(CMD);
  reg('add', CMD, '/ve', '/t', 'REG_SZ', '/d', before, '/f');   // what releaseClaudeLinks does
  const restored = readDefault(CMD);
  check(before === OLD && after === NEW && restored === OLD,
    'a protocol handler can be claimed and handed back', `${before} -> ${after} -> ${restored}`);
} finally {
  try { reg('delete', KEY, '/f'); } catch {}
}

// ── the picker, in the real app ────────────────────────────────────────────
if (!fs.existsSync(STUB_EXE) || fs.statSync(STUB_EXE).size < 1024) {
  fs.mkdirSync(path.dirname(STUB_EXE), { recursive: true });
  fs.copyFileSync(process.execPath, STUB_EXE);   // starts and exits: enough to prove the launch
}
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'facet.json'), JSON.stringify({ profiles: [
  { id: 'a', name: 'Personal', slug: 'personal', adopted: false },
  { id: 'b', name: 'Work', slug: 'work', adopted: false },
] }));
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ onboardingComplete: true, globalHotkey: '', customClaudePath: STUB_EXE }));

const child = spawn(path.join(APP, 'Facet.exe'),
  ['--portable', `--user-data-dir=${path.join(ROOT, 'udd-links')}`, `--remote-debugging-port=${PORT}`, LINK],
  { stdio: 'ignore' });
try {
  const page = await CDP.connect((await waitForTarget(PORT, (t) => t.type === 'page', 45000)).webSocketDebuggerUrl);
  const until = Date.now() + 20000;
  let view = '';
  while (Date.now() < until && view !== 'link') { view = await page.eval('state.view').catch(() => ''); await sleep(120); }
  check(view === 'link', 'a link on the command line opens the picker', view);
  check((await page.eval('document.querySelectorAll(".lane").length')) === 2, 'every profile is offered');
  check(/claude\.ai\/new/.test(await page.eval('document.querySelector(".link-url")?.textContent || ""')), 'the link is shown');

  await page.eval("onOpenLinkIn(state.profiles.find(p => p.id === 'b'))");
  await sleep(1500);
  const log = fs.readdirSync(path.join(DATA, 'logs')).map((f) => fs.readFileSync(path.join(DATA, 'logs', f), 'utf8')).join('');
  const launched = (log.match(/\[info\] launched .*/g) || []).pop() || '';
  check(/"name":"Work"/.test(launched), 'the profile you chose is the one that opens', launched.slice(0, 100));
  check(/"link":"claude:/.test(launched), 'the link is passed on to it');
  check((await page.eval('state.link')) === null, 'the picker clears itself afterwards');
  check(!/uncaught/.test(log), 'no uncaught error');
} finally {
  killTree(child.pid);
  await sleep(400);
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nclaude:// links reach the profile you pick');
process.exit(bad ? 1 : 0);
