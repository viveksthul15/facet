#!/usr/bin/env node
// Deterministic data generator for the Facet benchmarks.
//   node bench/gen-data.mjs            generate everything that is missing
//   node bench/gen-data.mjs --force    regenerate
// Output goes to FACET_BENCH_ROOT (see config.mjs) — never into the repo.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, PROFILE_TIERS, SESSION_TIERS, EXPORT_TARGETS, sessionsHome, profilesData, STUB_EXE,
} from './config.mjs';

const FORCE = process.argv.includes('--force');

// ── seeded PRNG (mulberry32) ────────────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-8${hex(r, 3)}-${hex(r, 12)}`;

const WORDS = ('the function returns value when render state profile session export panel tray window ' +
  'error build test cache index query filter sort parse write read stream buffer path file folder ' +
  'commit branch merge diff patch module import async await promise timeout retry spawn process ' +
  'memory cpu profile benchmark median latency startup bundle installer update config policy').split(' ');
const SPICE = ['naïve café', '日本語のテキスト', 'שלום עולם', '🚀✨ done', 'Ünïcödé', 'line1\r\nline2', '"quoted" \\ back', '<system-reminder>x</system-reminder>'];

function prose(r, bytes) {
  const out = [];
  let n = 0;
  while (n < bytes) {
    const w = r() < 0.02 ? SPICE[Math.floor(r() * SPICE.length)] : WORDS[Math.floor(r() * WORDS.length)];
    out.push(r() < 0.08 ? `${w}.\n` : w);
    n += w.length + 1;
  }
  return out.join(' ');
}

// ── one transcript ──────────────────────────────────────────────────────────
function writeTranscript(file, id, targetBytes, r, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  let written = 0;
  let t = Date.UTC(2026, 5, 1) + Math.floor(r() * 80 * 86400e3);
  const cwd = opts.cwd || 'C:\\work\\project';
  const base = () => ({
    uuid: uuid(r), sessionId: id, cwd, version: '2.1.80', gitBranch: 'main',
    timestamp: new Date((t += 1000 + Math.floor(r() * 90000))).toISOString(),
  });
  const put = (obj) => {
    const s = JSON.stringify(obj) + '\n';
    written += fs.writeSync(fd, s);
  };
  const tiny = targetBytes <= 4096;
  put({ type: 'user', message: { role: 'user', content: prose(r, tiny ? 60 : 400) }, permissionMode: 'default', ...base() });
  put({ type: 'ai-title', title: `${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]} ${SPICE[Math.floor(r() * 5)]}`, ...base() });
  let i = 0;
  while (written < targetBytes) {
    const left = targetBytes - written;
    i++;
    if (i % 9 === 0) {
      put({ type: 'user', message: { role: 'user', content: prose(r, Math.min(left, 100 + r() * 1500)) }, ...base() });
      continue;
    }
    const toolId = `toolu_${hex(r, 20)}`;
    put({
      type: 'assistant', effort: 'high',
      message: {
        role: 'assistant', model: 'claude-opus-5',
        content: [
          { type: 'text', text: prose(r, Math.min(left, 80 + r() * 1200)) },
          { type: 'tool_use', id: toolId, name: r() < 0.5 ? 'Bash' : 'Read', input: { command: prose(r, 40), description: prose(r, 30) } },
        ],
      },
      ...base(),
    });
    if (written >= targetBytes) break;
    // tool results: mostly small, sometimes big — that is where real transcripts get their bulk
    const big = r();
    const sz = big < 0.03 ? 300e3 : big < 0.25 ? 20e3 + r() * 40e3 : 200 + r() * 4000;
    put({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: prose(r, Math.min(targetBytes - written, sz)) }] }] },
      ...base(),
    });
  }
  if (opts.customTitle) put({ type: 'custom-title', customTitle: opts.customTitle, ...base() });
  fs.closeSync(fd);
  return { bytes: written, lastMs: t };
}

// ── session stores ──────────────────────────────────────────────────────────
function genSessions(tier, spec) {
  const home = sessionsHome(tier);
  const marker = path.join(home, '.generated');
  if (fs.existsSync(marker) && !FORCE) return console.log(`sessions/${tier}: present`);
  fs.rmSync(home, { recursive: true, force: true });
  const projects = path.join(home, '.claude', 'projects');
  const r = rng(0xFACE7 + tier.length * 131 + spec.sessions);
  let total = 0;
  const now = Date.now();
  for (let i = 0; i < spec.sessions; i++) {
    const size = spec.fixed
      ? spec.fixed[i]
      : Math.max(600, Math.min(spec.cap, Math.round(spec.median * Math.exp(spec.sigma * gauss(r)))));
    const proj = `C--work-proj-${String(Math.floor(r() * spec.projects)).padStart(3, '0')}`;
    const id = uuid(r);
    const file = path.join(projects, proj, `${id}.jsonl`);
    total += writeTranscript(file, id, size, r, { cwd: `C:\\work\\proj-${proj.slice(-3)}`, customTitle: r() < 0.1 ? `Custom ${i}` : null }).bytes;
    const m = new Date(now - Math.floor(r() * 90 * 86400e3));
    fs.utimesSync(file, m, m);
  }
  if (spec.targets) {
    for (const tg of EXPORT_TARGETS) {
      const proj = 'C--work-export-targets';
      const file = path.join(projects, proj, `${tg.id}.jsonl`);
      total += writeTranscript(file, tg.id, tg.bytes, r, { cwd: 'C:\\work\\export-targets' }).bytes;
      const sdir = path.join(projects, proj, tg.id);
      for (let k = 0; k < (tg.subagents || 0); k++) {
        const aid = hex(r, 16);
        writeTranscript(path.join(sdir, 'subagents', `agent-${aid}.jsonl`), tg.id, Math.round(tg.bytes / 20), r);
        fs.writeFileSync(path.join(sdir, 'subagents', `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: prose(r, 40) }));
      }
      for (let k = 0; k < (tg.toolResults || 0); k++) {
        fs.mkdirSync(path.join(sdir, 'tool-results'), { recursive: true });
        fs.writeFileSync(path.join(sdir, 'tool-results', `toolu_${hex(r, 20)}.txt`), prose(r, 100e3 + r() * 900e3));
      }
    }
  }
  fs.writeFileSync(marker, JSON.stringify({ tier, sessions: spec.sessions + (spec.targets ? EXPORT_TARGETS.length : 0), bytes: total }));
  console.log(`sessions/${tier}: ${spec.sessions} sessions, ${(total / 1048576).toFixed(0)} MB`);
}

// ── profile stores (a ready-made portable FacetData folder per tier × detection mode) ───────
const CHROMIUM_DIRS = ['Cache/Cache_Data', 'Code Cache/js', 'Code Cache/wasm', 'IndexedDB/https_claude.ai_0.indexeddb.leveldb',
  'Local Storage/leveldb', 'Session Storage', 'GPUCache', 'Network', 'blob_storage/a1', 'logs', 'sentry', 'Service Worker/CacheStorage/x/y'];
const COLORS = ['indigo', 'emerald', 'amber', 'rose', 'violet', 'sky'];

function genProfiles(tier, spec, mode) {
  const data = profilesData(tier, mode);
  const marker = path.join(data, '.generated');
  if (fs.existsSync(marker) && !FORCE) return console.log(`profiles/${tier}-${mode}: present`);
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(path.join(data, 'profiles'), { recursive: true });
  const r = rng(0xFACE7 ^ (spec.profiles * 7919));
  const profiles = [];
  for (let i = 0; i < spec.profiles; i++) {
    const name = i < 3 ? ['Work', 'Personal', 'Client — Novacore'][i] : `Profile ${i} ${WORDS[Math.floor(r() * WORDS.length)]}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    profiles.push({ id: `p_${hex(r, 8)}_${hex(r, 4)}`, name, slug, color: COLORS[i % 6], adopted: false, createdAt: new Date(Date.UTC(2026, 6, 1) + i * 3600e3).toISOString() });
    const d = path.join(data, 'profiles', slug, 'Local Storage');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'marker'), 'x');
  }
  for (let o = 0; o < spec.orphans; o++) {
    const od = path.join(data, 'profiles', `old-profile-${o}`);
    for (const sub of CHROMIUM_DIRS) fs.mkdirSync(path.join(od, sub), { recursive: true });
    for (let f = 0; f < spec.filesPerOrphan; f++) {
      const sub = CHROMIUM_DIRS[f % 3 === 0 ? 0 : Math.floor(r() * CHROMIUM_DIRS.length)];
      fs.writeFileSync(path.join(od, sub, `f_${f.toString(16).padStart(6, '0')}`), 'x'.repeat(64));
    }
  }
  fs.writeFileSync(path.join(data, 'facet.json'), JSON.stringify({ profiles }, null, 2));
  // No global hotkey: a second Facet must not fight the user's real one for Ctrl+Alt+C.
  const settings = { onboardingComplete: true, globalHotkey: '' };
  if (mode === 'stub') settings.customClaudePath = STUB_EXE;
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(marker, JSON.stringify({ tier, mode, ...spec }));
  console.log(`profiles/${tier}-${mode}: ${spec.profiles} profiles, ${spec.orphans}×${spec.filesPerOrphan} orphan files`);
}

fs.mkdirSync(path.dirname(STUB_EXE), { recursive: true });
if (!fs.existsSync(STUB_EXE)) fs.writeFileSync(STUB_EXE, ''); // only ever existsSync()'d, never launched
console.log(`bench root: ${ROOT}`);
for (const [tier, spec] of Object.entries(PROFILE_TIERS)) {
  genProfiles(tier, spec, 'stub');   // Claude found instantly (classic installer / custom path)
  genProfiles(tier, spec, 'detect'); // real auto-detection on this machine (MSIX probe if Store install)
}
for (const [tier, spec] of Object.entries(SESSION_TIERS)) genSessions(tier, spec);
