#!/usr/bin/env node
// Turn a results file into Markdown.
//   node bench/report.mjs 0.1.2                 -> bench/results/report-0.1.2.md
//   node bench/report.mjs 0.2.0 --before 0.1.2  -> bench/results/compare-0.1.2-vs-0.2.0.md
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS_DIR, PROFILE_TIERS, SESSION_TIERS } from './config.mjs';

const label = process.argv[2];
const bi = process.argv.indexOf('--before');
const beforeLabel = bi > 0 ? process.argv[bi + 1] : null;
const load = (l) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `results-${l}.json`), 'utf8'));
const R = load(label);
const B = beforeLabel ? load(beforeLabel) : null;

const ms = (s) => (s ? `${fmt(s.median)} (${fmt(s.min)}–${fmt(s.max)})` : '—');
const fmt = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n >= 100 ? Math.round(n) : n} ms`);
export const speedup = (oldV, newV) => {
  if (oldV == null || newV == null || !newV) return '—';
  const x = oldV / newV;
  if (x >= 2) return `**${x >= 10 ? Math.round(x) : x.toFixed(1)}× faster**`;
  if (x >= 1.05) return `${Math.round((1 - newV / oldV) * 100)}% faster`;
  if (x > 0.95) return 'same';
  return `⚠ ${Math.round((newV / oldV - 1) * 100)}% slower`;
};
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const tierDesc = (k) => { const [t, mode] = k.split('/'); const p = PROFILE_TIERS[t]; return `${t} — ${p.profiles} profiles, ${p.orphans}×${p.filesPerOrphan} unlinked files, ${mode === 'stub' ? 'Claude path known' : 'auto-detect (Store/MSIX probe)'}`; };

const out = [];
const S = R.suites;
out.push(B ? `# Facet ${beforeLabel} → ${label}: before / after` : `# Facet ${label} — performance baseline`, '');
out.push(`Machine: ${R.machine.cpu}, ${R.machine.logicalCores} threads, ${R.machine.ramGB} GB RAM, ${R.machine.disk}, ${R.machine.os}. Electron ${R.electron}. Power: ${R.machine.power}.`, '');
out.push('Timings are `median (min–max)`. ' + `Cold start: ${R.method.coldStartRuns} runs after ${R.method.warmupRunsDiscarded} discarded warm-up. Build: ${R.method.build}.`, '');

// generic two-mode row builder: [name, getter]
function section(title, keys, metrics, get, getB) {
  out.push(`## ${title}`, '');
  for (const k of keys) {
    out.push(`**${k.desc}**`, '');
    const rows = metrics.map(([name, m]) => {
      const a = get(k.key, m);
      if (!a) return null;
      if (!B) return [name, ms(a)];
      const b = getB(k.key, m);
      return [name, ms(b), ms(a), speedup(b?.median, a.median)];
    }).filter(Boolean);
    out.push(table(B ? ['', beforeLabel, label, 'change'] : ['', label], rows), '');
  }
}

if (S.cold) {
  out.push('## Cold start → profiles visible in the panel', '');
  const rows = Object.keys(S.cold).filter((k) => !k.startsWith('__')).map((k) => {
    const a = S.cold[k].firstContentMs, b = B?.suites.cold?.[k]?.firstContentMs;
    return B ? [tierDesc(k), ms(b), ms(a), speedup(b?.median, a.median)] : [tierDesc(k), ms(a), ms(S.cold[k].mainReadyMs)];
  });
  out.push(table(B ? ['scenario', beforeLabel, label, 'change'] : ['scenario', 'first content', 'of which: main process ready'], rows), '');
}
if (S.actions) {
  section('Panel actions', Object.keys(S.actions).filter((k) => !k.startsWith('__')).map((key) => ({ key, desc: tierDesc(key) })), [
    ['profiles:list round trip (paid by every action)', 'listIpcMs'], ['refresh + re-render', 'refreshAndRenderMs'],
    ['render profile list', 'renderProfilesMs'], ['open Manage', 'openManageMs'], ['open Settings', 'openSettingsMs'],
    ['reorder ×2', 'reorderMs'], ['rename ×2', 'renameMs'], ['new-profile name check, per keystroke', 'preflightKeystrokeMs'],
    ['list unlinked folders (Recovery)', 'listOrphansMs'],
  ], (k, m) => S.actions[k][m], (k, m) => B?.suites.actions?.[k]?.[m]);
}
if (S.sessions) {
  section('Export-a-session view', Object.keys(S.sessions).filter((k) => !k.startsWith('__')).map((key) => ({ key, desc: `${key} — ${S.sessions[key].rows} sessions (${SESSION_TIERS[key].sessions} generated${SESSION_TIERS[key].targets ? ' + export targets' : ''})` })), [
    ['open view → list shown', 'openSessionsViewMs'], ['re-render list', 'renderListMs'], ['filter, per keystroke', 'filterKeystrokeMs'],
  ], (k, m) => S.sessions[k][m], (k, m) => B?.suites.sessions?.[k]?.[m]);
}
if (S.export) {
  out.push('## Export one session to zip (transcript size)', '');
  const rows = Object.keys(S.export).filter((k) => !k.startsWith('__')).map((k) => {
    const a = S.export[k], b = B?.suites.export?.[k];
    return B ? [k, ms(b?.exportMs), ms(a.exportMs), speedup(b?.exportMs.median, a.exportMs.median), `${b?.zipMB} → ${a.zipMB} MB`] : [k, ms(a.exportMs), `${a.zipMB} MB`, a.turns];
  });
  out.push(table(B ? ['transcript', beforeLabel, label, 'change', 'zip'] : ['transcript', 'export time', 'zip size', 'turns'], rows), '');
}
if (S.memory || S.sizes) {
  out.push('## Footprint', '');
  const rows = [];
  const add = (name, a, b, unit, lowerBetter = true) => rows.push(B ? [name, `${b ?? '—'} ${unit}`, `${a ?? '—'} ${unit}`, lowerBetter ? speedup(b, a).replace('faster', 'smaller').replace('slower', 'bigger') : ''] : [name, `${a ?? '—'} ${unit}`]);
  const m = S.memory, bm = B?.suites.memory, z = S.sizes, bz = B?.suites.sizes;
  if (m) {
    add(`memory, idle, whole process tree (${m.idle.processes} processes) — working set`, m.idle.workingSetMB, bm?.idle.workingSetMB, 'MB');
    add('memory, idle — private bytes', m.idle.privateMB, bm?.idle.privateMB, 'MB');
    add(`CPU when idle (% of one core, ${m.idleWindowSec} s window)`, m.idleCpuPctOfOneCore, bm?.idleCpuPctOfOneCore, '%');
  }
  if (S.sessions?.large) add('memory with 215-session list loaded — working set', S.sessions.large.memoryAfterList.workingSetMB, B?.suites.sessions?.large?.memoryAfterList.workingSetMB, 'MB');
  if (z) {
    add('installer', z.installerMB, bz?.installerMB, 'MB'); add('portable exe', z.portableMB, bz?.portableMB, 'MB');
    add('installed on disk', z.installedMB, bz?.installedMB, 'MB'); add('app code (app.asar)', z.appAsarKB, bz?.appAsarKB, 'KB');
  }
  out.push(table(B ? ['', beforeLabel, label, 'change'] : ['', label], rows), '');
}
out.push('## Conditions during the run', '');
out.push(table(['suite', 'power', 'free RAM before → after', 'machine CPU load before → after'],
  Object.entries(R.environment).map(([k, e]) => [k, e.power, `${e.before.freeRamGB} → ${e.after.freeRamGB} GB`, `${e.before.cpuLoadPct}% → ${e.after.cpuLoadPct}%`])), '');
if (B) {
  out.push(`Baseline (${beforeLabel}) conditions:`, '', table(['suite', 'power', 'free RAM before → after', 'machine CPU load before → after'],
    Object.entries(B.environment).map(([k, e]) => [k, e.power, `${e.before.freeRamGB} → ${e.after.freeRamGB} GB`, `${e.before.cpuLoadPct}% → ${e.after.cpuLoadPct}%`])), '');
}
const file = path.join(RESULTS_DIR, B ? `compare-${beforeLabel}-vs-${label}.md` : `report-${label}.md`);
fs.writeFileSync(file, out.join('\n'));
console.log(file);
