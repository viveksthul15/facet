#!/usr/bin/env node
// Which Claude data directory Facet offers for adoption, across the layouts a Windows machine can
// present: classic installer, Microsoft Store with and without the %APPDATA%\\Claude link, a
// leftover empty folder from an uninstalled build, and nothing at all.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './config.mjs';

const WORK = path.join(os.tmpdir(), `facet-adopt-${process.pid}`);
const src = fs.readFileSync(path.join(REPO, 'main.js'), 'utf8');
function extract(name) {
  const at = src.indexOf(`function ${name}(`);
  let depth = 0;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(at, k + 1);
  }
  throw new Error(`cannot extract ${name}`);
}
const require = createRequire(import.meta.url);
// the real code, with only the two path constants injected
const build = (candidates) => new Function('fs', 'path', 'CLAUDE_DATA_CANDIDATES', 'SESSION_MARKERS',
  `${extract('hasClaudeSession')}\n${extract('detectAdoptableDir')}\nreturn detectAdoptableDir;`,
)(require('fs'), require('path'), candidates, ['Local Storage', 'IndexedDB', path.join('Network', 'Cookies')]);

const MARKERS = ['Local Storage', 'IndexedDB', path.join('Network', 'Cookies')];
const mk = (dir, markers) => { fs.mkdirSync(dir, { recursive: true }); for (const m of markers) fs.mkdirSync(path.join(dir, m), { recursive: true }); };

const cases = [
  { name: 'classic installer: %APPDATA%\\Claude holds the session', appdata: MARKERS, store: null, expect: 'appdata' },
  { name: 'Store build, no link: %APPDATA%\\Claude empty, package holds the session', appdata: [], store: MARKERS, expect: 'store' },
  { name: 'Store build, no link, no %APPDATA%\\Claude at all', appdata: null, store: MARKERS, expect: 'store' },
  { name: 'leftover empty folder, nothing signed in anywhere', appdata: [], store: [], expect: null },
  { name: 'no Claude data at all', appdata: null, store: null, expect: null },
  { name: 'partial folder: Cache only, no session state', appdata: ['Cache', 'GPUCache'], store: null, expect: null },
  { name: 'only Network\Cookies present', appdata: [path.join('Network', 'Cookies')], store: null, expect: 'appdata' },
  { name: 'Store build WITH the %APPDATA%\\Claude link (this machine): one folder, not two', appdata: 'LINK', store: MARKERS, expect: 'appdata' },
];

let bad = 0;
for (const c of cases) {
  fs.rmSync(WORK, { recursive: true, force: true });
  const appdata = path.join(WORK, 'Roaming', 'Claude');
  const store = path.join(WORK, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
  if (c.store) mk(store, c.store);
  if (c.appdata === 'LINK') {
    fs.mkdirSync(path.dirname(appdata), { recursive: true });
    execFileSync('cmd', ['/c', 'mklink', '/J', appdata, store], { stdio: 'ignore' }); // what Windows does for the Store build
  } else if (c.appdata) mk(appdata, c.appdata);
  else if (c.appdata !== null) fs.mkdirSync(appdata, { recursive: true });
  if (Array.isArray(c.appdata) && c.appdata.length === 0) fs.mkdirSync(appdata, { recursive: true });

  const got = build([appdata, store])();
  const want = c.expect === 'appdata' ? appdata : c.expect === 'store' ? store : null;
  const ok = got === want;
  if (!ok) bad++;
  const show = (p) => (p === null ? 'nothing to adopt' : p === appdata ? '%APPDATA%\\Claude' : p === store ? 'Store package folder' : p);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}\n        offers: ${show(got)}${ok ? '' : `   expected: ${show(want)}`}`);
}

// Profiles adopted before 0.2.1 carry no dataDir; they must still resolve to %APPDATA%\\Claude.
const profileDir = new Function('path', 'PROFILE_ROOT', 'CLAUDE_DATA_DIR',
  `${extract('profileDir')}
return profileDir;`)(require('path'), 'R', 'APPDATA_CLAUDE');
const compat = [
  [{ adopted: true }, 'APPDATA_CLAUDE'],
  [{ adopted: true, dataDir: 'STORE_DIR' }, 'STORE_DIR'],
  [{ adopted: false, slug: 'work' }, require('path').join('R', 'profiles', 'work')],
];
for (const [profile, want] of compat) {
  const got = profileDir(profile);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  profileDir(${JSON.stringify(profile)}) -> ${got}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(bad ? `\nFAILED — ${bad}/${cases.length}` : `\nall ${cases.length} layouts resolve correctly`);
process.exit(bad ? 1 : 0);
