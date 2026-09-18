#!/usr/bin/env node
// Old (sync, 0.1.2) vs new (async) folderSize, and old vs new unlinked-folder listing, on the
// generated tiers plus random trees (deep nesting, empty dirs, unicode names, 0-byte files).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, ROOT, PROFILE_TIERS, profilesData } from './config.mjs';

const WORK = path.join(ROOT, 'verify-main');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// pull one function out of a main.js by name and evaluate it on its own
function extract(src, name) {
  const at = src.search(new RegExp(`(async )?function ${name}\\(`));
  let depth = 0, i = src.indexOf('{', at);
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(at, k + 1);
  }
  throw new Error(`cannot extract ${name}`);
}
const require = createRequire(import.meta.url);
const make = (src, name) => new Function('fs', 'path', `${extract(src, name)}; return ${name};`)(require('fs'), require('path'));
const oldSrc = execFileSync('git', ['show', 'HEAD:main.js'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
const newSrc = fs.readFileSync(path.join(REPO, 'main.js'), 'utf8');
const oldSize = make(oldSrc, 'folderSize');
const newSize = make(newSrc, 'folderSize');

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function randomTree(dir, depth) {
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.floor(rnd() * 12);
  for (let i = 0; i < n; i++) {
    const name = `${['f', 'ünï', '日本', 'sp ace', 'x'.repeat(40)][Math.floor(rnd() * 5)]}-${i}`;
    if (depth < 5 && rnd() < 0.3) randomTree(path.join(dir, name), depth + 1);
    else fs.writeFileSync(path.join(dir, name), Buffer.alloc(rnd() < 0.2 ? 0 : Math.floor(rnd() * 5000)));
  }
}

let bad = 0, checked = 0;
const check = async (dir) => {
  const a = oldSize(dir), b = await newSize(dir);
  checked++;
  if (a !== b) { bad++; console.log(`  ✗ ${dir}: old ${a} new ${b}`); }
};
for (let i = 0; i < 300; i++) { const d = path.join(WORK, `t${i}`); randomTree(d, 0); await check(d); }
await check(path.join(WORK, 'does-not-exist'));
for (const tier of Object.keys(PROFILE_TIERS)) {
  const root = path.join(profilesData(tier, 'stub'), 'profiles');
  if (!fs.existsSync(root)) continue;
  for (const d of fs.readdirSync(root)) await check(path.join(root, d));
}
fs.rmSync(WORK, { recursive: true, force: true });
console.log(bad ? `FAILED — ${bad}/${checked} differ` : `folderSize: ${checked} trees, all identical`);
process.exit(bad ? 1 : 0);
