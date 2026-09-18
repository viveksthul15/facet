#!/usr/bin/env node
// Proof that the rewritten export tool produces what the 0.1.2 tool produced.
//   node bench/verify-export.mjs [--n 3000] [--exports 30]
//
//  1. metadata + readable Markdown: old functions vs new functions, on thousands of randomised
//     and hostile transcripts (bad JSON, CRLF, BOM, blank lines, unicode, missing fields, titles
//     in every order, keywords hidden inside strings, 0-byte and >768 KB files).
//  2. --list --json: old tool vs new tool (cold cache, then warm cache) on the same store.
//  3. whole exports: old zip (Compress-Archive) vs new zip (in-process), extracted with Windows'
//     own extractor and compared file by file; repeated with zip64 records forced on.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO, ROOT } from './config.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const N = opt('--n', 3000);
const EXPORTS = opt('--exports', 30);
const OLD = path.join(REPO, 'bench', 'reference', 'session-export-0.1.2.mjs');
const NEW = path.join(REPO, 'tools', 'session-export.mjs');
const WORK = path.join(ROOT, 'verify');
const HOME = path.join(WORK, 'home');
const LOCAL = path.join(WORK, 'local');
const PROJECTS = path.join(HOME, '.claude', 'projects');

// ── seeded randomness ───────────────────────────────────────────────────────
let seed = 0xC0FFEE;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
const STR = ['plain words here', 'naïve café', '日本語のテキスト', 'שלום עולם', '🚀✨ emoji 👩‍👩‍👧', 'tab\there', 'cr\r\nlf', 'quote " and \\ slash',
  '"type":"user"', '"ai-title" inside a string', '"model":"fake"', '-title"', '"timestamp":"1999-01-01"', '<system-reminder>injected</system-reminder>',
  '<command-name>/x</command-name>', ' <local-command-stdout>y', '', ' ', '\u2028line sep', 'a'.repeat(300), '\ud83d lone surrogate'];
const text = (max = 3) => Array.from({ length: 1 + Math.floor(rnd() * max) }, () => pick(STR)).join(pick([' ', '\n', '\n\n']));

function randomLine(t) {
  const base = {};
  if (chance(0.9)) base.timestamp = new Date(t).toISOString();
  if (chance(0.8)) base.cwd = pick(['C:\\work\\a', 'D:\\x y\\b', '/home/u/p', '']);
  if (chance(0.7)) base.sessionId = hex(8);
  if (chance(0.3)) base.permissionMode = pick(['default', 'plan', 'acceptEdits']);
  if (chance(0.5)) base.version = pick(['2.1.80', '2.0.1']);
  if (chance(0.5)) base.gitBranch = pick(['main', '', null, 'feat/x']);
  const kind = rnd();
  if (kind < 0.25) return { type: 'user', message: { role: 'user', content: text() }, ...base };
  if (kind < 0.45) {
    return { type: 'user', message: { role: 'user', content: Array.from({ length: Math.floor(rnd() * 3) }, () => pick([
      { type: 'tool_result', content: text(6) }, { type: 'tool_result', content: [{ type: 'text', text: 'x'.repeat(Math.floor(rnd() * 9000)) }, { type: 'image' }] },
      { type: 'tool_result' }, { type: 'text', text: 'not a result' }])) }, ...base };
  }
  if (kind < 0.75) {
    return { type: 'assistant', ...(chance(0.4) ? { effort: pick(['low', 'high']) } : {}), message: { role: 'assistant', ...(chance(0.8) ? { model: pick(['claude-opus-5', 'claude-sonnet-5']) } : {}),
      content: chance(0.1) ? 'string content' : Array.from({ length: Math.floor(rnd() * 4) }, () => pick([
        { type: 'text', text: text() }, { type: 'text', text: '   ' }, { type: 'thinking', thinking: 'hm' },
        { type: 'tool_use', name: pick(['Bash', 'Read']), input: pick([{ command: `ls\n${text()}` }, { description: 'd'.repeat(200) }, { file_path: 'C:\\f' }, { prompt: text() }, {}, undefined]) }])) }, ...base };
  }
  if (kind < 0.82) return { type: 'ai-title', title: pick(['Auto title', '', 'タイトル']), ...base };
  if (kind < 0.87) return { type: 'custom-title', customTitle: pick(['My title', '', 'Ünï']), ...base };
  if (kind < 0.92) return { type: pick(['summary', 'system', 'file-history-snapshot']), note: text(), ...base };
  return pick([{}, { type: 'user' }, { type: 'assistant', message: null }, { message: { content: text() } }, [1, 2], 'a string', 42]); // a bare `null` line crashes the 0.1.2 tool outright; the new one skips it
}

function randomTranscript(targetBytes) {
  const out = [];
  let n = 0, t = Date.UTC(2026, 3, 1) + Math.floor(rnd() * 1e10);
  if (chance(0.03)) out.push('\ufeff');
  while (n < targetBytes) {
    t += Math.floor(rnd() * 60000);
    let s;
    const r = rnd();
    if (r < 0.04) s = pick(['', '   ', '{bad json', '{"type":"user"', 'not json at all', '{"type":"ai-title","title":"broken"']);
    else {
      s = JSON.stringify(randomLine(t));
      if (r > 0.97) s = JSON.stringify(JSON.parse(s), null, 0).replace(/":/g, '": '); // spaced, still one line
    }
    s += chance(0.1) ? '\r\n' : '\n';
    out.push(s);
    n += s.length;
  }
  let body = out.join('');
  if (chance(0.3)) body = body.replace(/\r?\n$/, ''); // no trailing newline
  return body;
}

// ── load functions from both implementations without running their CLI ──────
async function load(file, names, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`markers not found in ${file}`);
  const code = `import fs from "node:fs";\nconst OPTS = {};\n${src.slice(a, b)}\nexport { ${names.join(', ')} };`;
  const tmp = path.join(WORK, `impl-${path.basename(file)}-${names[0]}.mjs`);
  fs.writeFileSync(tmp, code);
  return import(`file://${tmp.replace(/\\/g, '/')}?${Date.now()}`);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failures = 0;
const KEEP = process.argv.includes('--keep');
const fail = (what, detail) => { failures++; if (failures <= 10) console.log(`  ✗ ${what}`, detail ?? ''); };

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(LOCAL, { recursive: true });

// 1 ── functions ─────────────────────────────────────────────────────────────
const oldMeta = await load(OLD, ['readMeta', 'listMeta'], '/** Read what the transcript itself records', '// ── readable transcript');
const oldMd = await load(OLD, ['readable'], 'function readable(', '// ── staging');
const neu = await load(NEW, ['eachLine', 'newMeta', 'eatMeta', 'listMeta', 'readableWriter'], '/**\n * Call fn(line)', '// ── zip');

function newFull(file, clip) {
  const m = neu.newMeta(), w = neu.readableWriter(clip);
  neu.eachLine(file, fs.statSync(file).size, (line) => {
    if (!line.trim()) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j === null || typeof j !== 'object') return;
    neu.eatMeta(m, j); w.eat(j);
  });
  return { m, ...w.end() };
}

console.log(`1. metadata + readable: ${N} randomised transcripts`);
const files = [];
for (let i = 0; i < N; i++) {
  const big = i % 25 === 0; // 4% exercise the sampled (>768 KB) listing path
  const size = i % 97 === 0 ? 0 : big ? 800e3 + rnd() * 1.4e6 : Math.floor(Math.exp(rnd() * 11.5));
  const dir = path.join(PROJECTS, `C--proj-${i % 40}`);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
  const f = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(f, randomTranscript(size));
  files.push({ f, id, dir });
}
const tmpMd = path.join(WORK, 'old-readable.md');
for (const { f } of files) {
  const size = fs.statSync(f).size;
  const clip = pick([4000, 50, 0, 100000]);
  const om = oldMeta.readMeta(f);
  const oc = oldMd.readable(f, tmpMd, clip);
  const n = newFull(f, clip);
  if (!same(om, n.m)) fail('readMeta differs', f);
  if (!same(oc, n.counts)) fail('readable counts differ', f);
  if (!fs.readFileSync(tmpMd).equals(n.body)) fail('readable Markdown differs', f);
  // only these six fields ever leave the tool; for small files the old listMeta returned the full readMeta object
  const row = (m) => ({ title: m.title ?? null, cwd: m.cwd ?? null, model: m.model ?? null, turns: m.turns ?? null, first: m.first ?? null, last: m.last ?? null });
  if (size > 400 && !same(row(oldMeta.listMeta(f, size)), row(neu.listMeta(f, size)))) fail('listMeta differs', f);
}
console.log(`   ${failures ? `${failures} FAILURES` : 'identical'}`);

// 2 ── --list --json through both CLIs ───────────────────────────────────────
console.log('2. --list --all --json: old tool vs new tool');
const env = { ...process.env, USERPROFILE: HOME, LOCALAPPDATA: LOCAL, APPDATA: path.join(WORK, 'roaming') };
const run = (tool, args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [tool, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${path.basename(tool)} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const cache = path.join(WORK, 'cache', 'session-list.json');
const before = failures;
const listOld = run(OLD, ['--list', '--all', '--json']);
for (const [label, args] of [['no cache', []], ['cold cache', ['--cache', cache]], ['warm cache', ['--cache', cache]]]) {
  if (run(NEW, ['--list', '--all', '--json', ...args]) !== listOld) fail(`list output differs (${label})`);
}
fs.appendFileSync(files[3].f, `${JSON.stringify({ type: 'custom-title', customTitle: 'changed after caching', timestamp: new Date().toISOString() })}\n`);
if (run(NEW, ['--list', '--all', '--json', '--cache', cache]) !== run(OLD, ['--list', '--all', '--json'])) fail('list differs after a transcript changed (stale cache)');
console.log(`   ${failures > before ? 'FAILED' : 'byte-identical JSON — uncached, cold cache, warm cache, and after a file changed'}`);

// 3 ── whole exports ─────────────────────────────────────────────────────────
console.log(`3. full exports: ${EXPORTS} sessions, old zip vs new zip`);
const expand = (zip, dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], { stdio: 'ignore' });
};
const tree = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? [`${r}/`, ...tree(dir, r)] : [r];
}).sort();
const b3 = failures;
const subjects = files.filter((_, i) => i % Math.floor(N / EXPORTS) === 1).slice(0, EXPORTS);
for (const [k, s] of subjects.entries()) {
  const sdir = path.join(s.dir, s.id);
  if (k % 2 === 0) {
    fs.mkdirSync(path.join(sdir, 'subagents', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sdir, 'subagents', `agent-${hex(6)}.jsonl`), randomTranscript(20000));
    fs.writeFileSync(path.join(sdir, 'subagents', 'nested', 'ünï cödé 日本.meta.json'), '{}');
    fs.mkdirSync(path.join(sdir, 'tool-results'), { recursive: true });
    fs.writeFileSync(path.join(sdir, 'tool-results', 'big.txt'), zlib.deflateSync(Buffer.from(text(4000))).toString('base64').repeat(40)); // > one zip chunk when large
    fs.writeFileSync(path.join(sdir, 'tool-results', 'empty.txt'), '');
  }
  if (k % 3 === 0) fs.mkdirSync(path.join(sdir, 'workflows'), { recursive: true }); // empty folder
  if (k % 4 === 0) {
    const temp = path.join(LOCAL, 'Temp', 'claude', path.basename(s.dir), s.id);
    fs.mkdirSync(path.join(temp, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'tasks', 'task1.output'), text(50));
    fs.writeFileSync(path.join(temp, 'scratchpad', 'a.py'), 'print(1)');
    fs.writeFileSync(path.join(temp, 'scratchpad', 'skip.bin'), 'nope');
  }
  const args = [s.id, '--json', '--no-logs', ...(k % 5 === 0 ? ['--no-extras'] : [])];
  const zo = path.join(WORK, 'old.zip'), zn = path.join(WORK, 'new.zip');
  const jo = JSON.parse(run(OLD, [...args, '--out', zo]).trim().split('\n').pop());
  const jn = JSON.parse(run(NEW, [...args, '--out', zn], k % 2 ? { SESSION_EXPORT_FORCE_ZIP64: '1' } : {}).trim().split('\n').pop());
  for (const key of ['id', 'title', 'turns', 'cwd', 'counts', 'excluded']) if (!same(jo[key], jn[key])) fail(`export summary .${key} differs`, s.id);
  const dOld = path.join(WORK, 'x-old'), dNew = path.join(WORK, 'x-new');
  expand(zo, dOld); expand(zn, dNew);
  const tOld = tree(dOld), tNew = tree(dNew);
  if (!same(tOld, tNew)) fail('archive file lists differ', JSON.stringify({ onlyOld: tOld.filter((x) => !tNew.includes(x)), onlyNew: tNew.filter((x) => !tOld.includes(x)) }));
  for (const rel of tOld.filter((x) => !x.endsWith('/') && tNew.includes(x))) {
    let a = fs.readFileSync(path.join(dOld, rel)), b = fs.readFileSync(path.join(dNew, rel));
    if (rel === 'local-session-state.json') { // carries the wall-clock time of the export
      const strip = (x) => JSON.stringify({ ...JSON.parse(x), capturedAt: 0 });
      a = Buffer.from(strip(a)); b = Buffer.from(strip(b));
    }
    if (!a.equals(b)) fail(`content differs: ${rel}`, s.id);
  }
}
console.log(`   ${failures > b3 ? 'FAILED' : 'same files, same bytes (zip64 forced on half of them)'}`);

if (!KEEP) fs.rmSync(WORK, { recursive: true, force: true });
console.log(failures ? `\nFAILED — ${failures} difference(s)` : '\nALL IDENTICAL');
process.exit(failures ? 1 : 0);
