#!/usr/bin/env node
// Does anything get cut off at the bottom of the panel? Drives the packaged app, walks every view
// and both overlays at the window heights Windows produces on common screens and display scales,
// and reports any control that sits below the visible area or any content that cannot be reached.
//
//   node bench/verify-layout.mjs [--label 0.2.1]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, profilesData } from './config.mjs';
import { CDP, waitForTarget, sleep } from './lib/cdp.mjs';
import { killTree } from './lib/sys.mjs';

const argv = process.argv.slice(2);
const LABEL = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : '0.2.1';
const APP = path.join(ROOT, `app-${LABEL}`);
const LIVE = path.join(APP, 'FacetData');

// height of the panel window in DIPs, as workArea - 48 would give on these screens
const SCREENS = [
  { name: '1920x1080 @100%', h: 1000 },
  { name: '1920x1080 @150%', h: 664 },
  { name: '1366x768  @100%', h: 680 },
  { name: '1366x768  @125%', h: 542 },
  { name: '1280x720  @150%', h: 432 },
  { name: 'small window', h: 360 },
];
const VIEWS = ['empty', 'populated', 'add', 'manage', 'settings', 'recovery', 'sessions'];

const setup = `(async () => {
  state.onboarding = false; state.confirm = null;
  await refresh();
  return 1;
})()`;

// Everything a user must be able to reach: buttons, inputs, and the last block of text in a card.
const CHECK = `(() => {
  const vh = window.innerHeight;
  const panel = document.querySelector('.panel');
  const overlay = panel && panel.querySelector(':scope > .confirm-overlay');
  const scope = overlay || panel;
  if (!scope) return { error: 'no panel' };
  const canScroll = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
    }
    return false;
  };
  const clipped = [];
  for (const el of scope.querySelectorAll('button, input, select, a, .lane, .ses-row, .orphan-row, li')) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    if (r.bottom > vh + 1) {
      const label = ((el.textContent || el.id || el.className).trim().slice(0, 40)) + ' @' + Math.round(r.bottom) + '/' + vh;
      clipped.push(canScroll(el) ? 'below the fold: ' + label : 'UNREACHABLE: ' + label);
    }
  }
  const cut = overlay ? (() => { const c = overlay.querySelector('.confirm-card'); const r = c.getBoundingClientRect();
    return r.bottom > vh + 1 || r.top < -1 ? 'card ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' of ' + vh : null; })() : null;
  return { clipped: [...new Set(clipped)].slice(0, 4), cardOutside: cut, windowH: vh };
})()`;

const src = profilesData('typical', 'stub');
fs.rmSync(LIVE, { recursive: true, force: true });
fs.renameSync(src, LIVE);
const child = spawn(path.join(APP, 'Facet.exe'),
  ['--portable', `--user-data-dir=${path.join(ROOT, 'udd-layout')}`, '--remote-debugging-port=9907', '--inspect=9908'], { stdio: 'ignore' });
let bad = 0;
try {
  const page = await CDP.connect((await waitForTarget(9907, (t) => t.type === 'page', 45000)).webSocketDebuggerUrl);
  const main = await CDP.connect((await waitForTarget(9908, () => true)).webSocketDebuggerUrl);
  while (!(await page.eval('!!document.querySelector(".panel")').catch(() => false))) await sleep(80);
  await page.eval(setup);
  // No stand-ins: the app's own panel:resize handler runs, and the display it reads is faked, so
  // the panel sizes itself exactly as it would on the screen being simulated.
  await main.eval(`
    const electron = process.mainModule.require('electron');
    globalThis.__limit = 1000;
    const fake = () => ({ workArea: { x: 0, y: 0, width: 1920, height: globalThis.__limit + 48 },
                          bounds: { x: 0, y: 0, width: 1920, height: globalThis.__limit + 48 }, scaleFactor: 1 });
    electron.screen.getDisplayNearestPoint = fake;
    electron.screen.getPrimaryDisplay = fake;
    globalThis.__win = () => electron.BrowserWindow.getAllWindows()[0].getSize()[1];
    1`);

  for (const screen of SCREENS) {
    const problems = [];
    const notes = [];
    for (const view of VIEWS) {
      for (const overlay of ['none', 'onboarding', 'remove']) {
        if (overlay === 'onboarding' && view !== 'empty') continue;
        if (overlay === 'remove' && view !== 'manage') continue;
        await main.eval(`globalThis.__limit = ${screen.h}; 1`);
        await page.eval(`(() => { state.onboarding = ${overlay === 'onboarding'};
          state.confirm = ${overlay === 'remove'} ? { profile: state.profiles[0] } : null;
          setView('${view}'); return 1; })()`);
        await sleep(260);
        // The panel is hidden during the test, and a hidden window throttles requestAnimationFrame,
        // which is what the app's own fitPanelHeight waits on. Ask for the height the same way it
        // would, so the real panel:resize handler runs on every pass.
        await page.eval(`(() => { const p = document.querySelector('.panel'); const prev = p.style.maxHeight;
          p.style.maxHeight = 'none'; const h = p.scrollHeight; p.style.maxHeight = prev;
          facet.resize({ height: h + 12 }); return h; })()`);
        await sleep(220);
        const r = await page.eval(CHECK);
        const label = overlay === 'none' ? view : `${view}+${overlay}`;
        const winH = await main.eval('globalThis.__win()');
        const asked = winH;
        // getSize reports device pixels rounded from DIPs, so a couple of pixels either way is
        // the display scale, not the layout
        if (winH > screen.h + 4) problems.push(`${label}: window ${winH}px on a ${screen.h}px screen — runs off the display`);
        if (r.error) { problems.push(`${label}: ${r.error}`); continue; }
        if (r.cardOutside) problems.push(`${label}: ${r.cardOutside}`);
        for (const c of r.clipped) {
          if (c.startsWith('UNREACHABLE')) problems.push(`${label}: ${c}`);
          else notes.push(`${label}: ${c}`);   // scrollable — visible after scrolling, not a defect
        }
        if (!r.clipped.length && !r.cardOutside && winH >= screen.h) notes.push(`${label}: fills the ${screen.h}px screen and scrolls`);
      }
    }
    bad += problems.length;
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${screen.name}  (panel ${screen.h}px)`);
    for (const p of problems.slice(0, 6)) console.log(`        ${p}`);
    if (!problems.length && notes.length) console.log(`        (${notes.length} view(s) scroll at this size — fine)`);
  }
} finally {
  killTree(child.pid);
  await sleep(400);
  fs.renameSync(LIVE, src);
}
console.log(bad ? `\nFAILED — ${bad} clipped element(s)` : `\nnothing clipped at any tested size`);
process.exit(bad ? 1 : 0);
