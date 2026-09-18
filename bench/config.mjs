// Shared benchmark configuration. Generated data never lives in the repo — it goes under
// FACET_BENCH_ROOT (default: %LOCALAPPDATA%/facet-bench — not %TEMP%, which Windows cleans up).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = process.env.FACET_BENCH_ROOT || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'facet-bench');
export const RESULTS_DIR = path.join(REPO, 'bench', 'results');

// Profile-store tiers. An orphan is a data folder no profile claims; Facet sizes each one by
// walking it. File counts are calibrated on real Claude Desktop data dirs (1k – 15k files each).
export const PROFILE_TIERS = {
  small:   { profiles: 1,   orphans: 0, filesPerOrphan: 0 },
  typical: { profiles: 3,   orphans: 1, filesPerOrphan: 1000 },
  large:   { profiles: 25,  orphans: 3, filesPerOrphan: 5000 },
  xl:      { profiles: 200, orphans: 5, filesPerOrphan: 15000 },
};

// Session-store tiers (~/.claude/projects). "large" mirrors the shape of a real heavy-use store
// (≈215 transcripts, ≈1 GB, biggest ≈100 MB). Sizes are log-normal: median / sigma / cap in bytes.
const MB = 1024 * 1024;
export const SESSION_TIERS = {
  small:   { sessions: 3,    projects: 1,   fixed: [1024, 20 * 1024, 200 * 1024] },
  typical: { sessions: 55,   projects: 12,  median: 0.3 * MB, sigma: 1.5, cap: 30 * MB, targets: true },
  large:   { sessions: 215,  projects: 64,  median: 1.0 * MB, sigma: 1.6, cap: 110 * MB },
  xl:      { sessions: 1000, projects: 150, median: 1.0 * MB, sigma: 1.4, cap: 40 * MB },
};

// Export targets, placed in the "typical" store. Bigger ones carry subagents + tool-results.
export const EXPORT_TARGETS = [
  { key: '1KB',   id: 'e0000001-0000-4000-8000-000000000001', bytes: 1024 },
  { key: '1MB',   id: 'e0000002-0000-4000-8000-000000000002', bytes: 1 * MB,   subagents: 2,  toolResults: 2 },
  { key: '20MB',  id: 'e0000003-0000-4000-8000-000000000003', bytes: 20 * MB,  subagents: 6,  toolResults: 8 },
  { key: '50MB',  id: 'e0000004-0000-4000-8000-000000000004', bytes: 50 * MB,  subagents: 10, toolResults: 12 },
  { key: '100MB', id: 'e0000005-0000-4000-8000-000000000005', bytes: 100 * MB, subagents: 12, toolResults: 16 },
];

export const sessionsHome = (tier) => path.join(ROOT, 'sessions', tier, 'home');
export const profilesData = (tier, mode) => path.join(ROOT, 'profiles', `${tier}-${mode}`, 'FacetData');
export const STUB_EXE = path.join(ROOT, 'claude-stub', 'Claude.exe');
