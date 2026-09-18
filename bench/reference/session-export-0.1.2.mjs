#!/usr/bin/env node
/**
 * Export a Claude Code session to a zip, in the layout the removed `/export` command produced.
 *
 * The layout is not invented — it was read off a real export archive (2026-08-26), and it is
 * NOT the same as the older 2026-05 one: `tool-results/` and `workflows/` moved inside the
 * session folder, the transcript is written twice, and `local-session-state.json` appeared. If
 * a future Claude Code changes it again, diff a fresh real export against LAYOUT below.
 *
 *   <cliSessionId>.jsonl                    raw transcript, at the archive root
 *   transcript.jsonl                        byte-identical duplicate of it
 *   <cliSessionId>/subagents/…              subagent transcripts + .meta.json + journal.jsonl
 *   <cliSessionId>/tool-results/*.txt       oversized tool results
 *   <cliSessionId>/workflows/…              workflow run records and the scripts as executed
 *   logs/*.log                              desktop app logs, zero-byte ones included
 *   metadata.json                           session metadata
 *   local-session-state.json                runtime state snapshot
 *   extras/                                 ADDED here, never in /export: task payloads,
 *                                           scratchpad scripts, readable Markdown transcript
 *
 * Usage:
 *   node export.mjs --list                       sessions, newest first
 *   node export.mjs --list --all                 across every project
 *   node export.mjs <sessionId|prefix> [opts]
 *   node export.mjs --latest [opts]              most recently modified session
 *
 * Options:
 *   --out <path>       destination zip (default: <cwd>/.exports/session-export-<id8>.zip)
 *   --no-extras        produce exactly what /export produced, nothing more
 *   --no-logs          skip the app logs (they can be tens of MB)
 *   --max-task <MB>    drop task payloads larger than this (default 20; 0 = keep all)
 *   --clip <chars>     tool-result clipping in the readable transcript (default 4000)
 *   --logs-dir <path>  extra app-log directory to search first (Facet passes the profile's)
 *   --json             machine-readable output — a session array for --list, a summary for an
 *                      export. Suppresses the human output so stdout stays parseable.
 *
 * Vendored into Facet from ~/.claude/skills/session-export/export.mjs. Keep the two in sync —
 * only the --json and --logs-dir additions below differ.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const PROJECTS = path.join(HOME, ".claude", "projects");
const TEMP_ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(HOME, "AppData", "Local"), "Temp", "claude");
const extraLogDir = (() => {
  const i = process.argv.indexOf("--logs-dir");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const LOG_DIRS = [
  extraLogDir,
  path.join(process.env.LOCALAPPDATA ?? "", "Claude", "logs"),
  path.join(process.env.APPDATA ?? "", "Claude", "logs"),
  path.join(HOME, "Library", "Logs", "Claude"),
  path.join(HOME, ".config", "Claude", "logs"),
].filter(Boolean);

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const target = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);

const OPTS = {
  list: flag("--list"),
  all: flag("--all"),
  latest: flag("--latest"),
  extras: !flag("--no-extras"),
  logs: !flag("--no-logs"),
  maxTaskMB: Number(val("--max-task", "20")),
  clip: Number(val("--clip", "4000")),
  out: val("--out", null),
  json: flag("--json"),
};

const iec = (n) =>
  n > 1073741824
    ? `${(n / 1073741824).toFixed(1)} GB`
    : n > 1048576
      ? `${(n / 1048576).toFixed(1)} MB`
      : n > 1024
        ? `${(n / 1024).toFixed(0)} KB`
        : `${n} B`;

// ── discovery ────────────────────────────────────────────────────────────────
/** Every session transcript on disk, newest first. */
function sessions() {
  if (!fs.existsSync(PROJECTS)) return [];
  const out = [];
  for (const proj of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      out.push({ id: f.slice(0, -6), project: proj, jsonl: p, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * The project slug is the working directory with separators and the drive colon replaced by
 * dashes, so it round-trips: "D:\Projects\x" -> "D--Projects-x". Recovering the cwd exactly is
 * not possible (a real dash is indistinguishable from a separator), so the transcript is the
 * authority — this is only used to locate the matching temp folder.
 */
const tempDirFor = (project, id) => path.join(TEMP_ROOT, project, id);

/** Read what the transcript itself records about the session. Never guessed. */
function readMeta(jsonl) {
  const m = {
    cwd: null,
    sessionId: null,
    model: null,
    effort: null,
    permissionMode: null,
    version: null,
    gitBranch: null,
    title: null,
    titleSource: null,
    first: null,
    last: null,
    turns: 0,
  };
  for (const line of fs.readFileSync(jsonl, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.timestamp) {
      m.first ??= j.timestamp;
      m.last = j.timestamp;
    }
    if (j.cwd) m.cwd = j.cwd;
    if (j.sessionId) m.sessionId = j.sessionId;
    if (j.permissionMode) m.permissionMode = j.permissionMode;
    if (j.version) m.version = j.version;
    if (j.gitBranch !== undefined) m.gitBranch = j.gitBranch;
    if (j.type === "custom-title" && j.customTitle) {
      m.title = j.customTitle;
      m.titleSource = "custom";
    }
    if (j.type === "ai-title" && j.title && m.titleSource !== "custom") {
      m.title = j.title;
      m.titleSource = "auto";
    }
    if (j.type === "assistant") {
      if (j.message?.model) m.model = j.message.model;
      if (j.effort) m.effort = j.effort;
    }
    if (j.type === "user" && typeof j.message?.content === "string") m.turns++;
  }
  return m;
}

/**
 * A cheaper readMeta for listing. A full read is exact but costs seconds across a hundred
 * sessions, and the panel only needs a label — so anything over HEAD+TAIL bytes is sampled from
 * both ends: the head carries cwd, model and the ai-title, the tail carries the last timestamp
 * and any title set later. Turn counts need every line, so a sampled row reports null instead of
 * a wrong number. Small transcripts still go through readMeta and stay exact.
 */
const LIST_HEAD = 512 * 1024;
const LIST_TAIL = 256 * 1024;

function listMeta(jsonl, size) {
  if (size <= LIST_HEAD + LIST_TAIL) return readMeta(jsonl);

  const fd = fs.openSync(jsonl, "r");
  let head, tail;
  try {
    head = Buffer.alloc(LIST_HEAD);
    fs.readSync(fd, head, 0, LIST_HEAD, 0);
    tail = Buffer.alloc(LIST_TAIL);
    fs.readSync(fd, tail, 0, LIST_TAIL, size - LIST_TAIL);
  } finally {
    fs.closeSync(fd);
  }

  const m = { cwd: null, model: null, title: null, titleSource: null, first: null, last: null, turns: null };
  const eat = (text, dropFirstLine) => {
    const lines = text.split("\n");
    if (dropFirstLine) lines.shift(); // a tail slice starts mid-line
    else lines.pop(); //  a head slice ends mid-line
    for (const line of lines) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.timestamp) { m.first ??= j.timestamp; m.last = j.timestamp; }
      if (j.cwd) m.cwd = j.cwd;
      if (j.type === "custom-title" && j.customTitle) { m.title = j.customTitle; m.titleSource = "custom"; }
      if (j.type === "ai-title" && j.title && m.titleSource !== "custom") { m.title = j.title; m.titleSource = "auto"; }
      if (j.type === "assistant" && j.message?.model) m.model = j.message.model;
    }
  };
  eat(head.toString("utf8"), false);
  eat(tail.toString("utf8"), true);
  return m;
}

// ── readable transcript ──────────────────────────────────────────────────────
function readable(jsonl, out, clip) {
  // Buffered, not streamed: the caller zips and deletes the staging dir immediately after, and
  // a write stream is still flushing at that point — measured, it threw ENOENT on its own file.
  const parts = [];
  const w = { write: (s) => parts.push(s), end: () => fs.writeFileSync(out, parts.join("")) };
  const cut = (s, n) => {
    const t = String(s ?? "").replace(/\r/g, "");
    return t.length > n ? `${t.slice(0, n)}\n… [${t.length - n} more chars omitted]` : t;
  };
  let users = 0;
  let replies = 0;
  let tools = 0;
  w.write("# Session transcript\n");
  for (const line of fs.readFileSync(jsonl, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type === "user" && typeof j.message?.content === "string") {
      const t = j.message.content;
      // harness-injected notices are not things the user typed
      if (/^<(command-name|local-command|system-reminder)/.test(t.trim())) continue;
      users++;
      w.write(`\n---\n\n## 👤 User\n\n${cut(t, 20000)}\n`);
    } else if (j.type === "user" && Array.isArray(j.message?.content)) {
      for (const c of j.message.content) {
        if (c.type !== "tool_result") continue;
        const b =
          typeof c.content === "string"
            ? c.content
            : Array.isArray(c.content)
              ? c.content.map((x) => x.text ?? `[${x.type}]`).join("\n")
              : "";
        w.write(`\n> **result** ${cut(b, clip).replace(/\n/g, "\n> ")}\n`);
      }
    } else if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      let head = false;
      for (const c of j.message.content) {
        if (c.type === "text" && c.text?.trim()) {
          if (!head) {
            w.write("\n## 🤖 Claude\n\n");
            head = true;
            replies++;
          }
          w.write(`${c.text}\n`);
        } else if (c.type === "tool_use") {
          tools++;
          const d = c.input?.description ?? c.input?.command ?? c.input?.file_path ?? c.input?.prompt ?? "";
          w.write(`\n\`⚙ ${c.name}\` — ${cut(String(d).split("\n")[0], 160)}\n`);
        }
      }
    }
  }
  w.end();
  return { users, replies, tools };
}

// ── staging ──────────────────────────────────────────────────────────────────
const copyDir = (src, dst) => {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
};

const walk = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? walk(p) : [{ p, size: fs.statSync(p).size }];
      })
    : [];

function zip(stageDir, outZip) {
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  if (fs.existsSync(outZip)) fs.rmSync(outZip);
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outZip}' -CompressionLevel Optimal`,
      ],
      { stdio: OPTS.json ? "ignore" : "inherit" },
    );
  } else {
    execFileSync("zip", ["-r", "-q", outZip, "."], { cwd: stageDir, stdio: "inherit" });
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const all = sessions();

if (OPTS.list || (!target && !OPTS.latest)) {
  const rows = OPTS.all ? all : all.filter((s) => s.project === all[0]?.project);
  if (OPTS.json) {
    // No slice — the caller does its own filtering and paging.
    console.log(
      JSON.stringify(
        rows.map((s) => {
          const m = s.size > 400 ? listMeta(s.jsonl, s.size) : {};
          return {
            id: s.id,
            project: s.project,
            size: s.size,
            mtime: s.mtime,
            title: m.title ?? null,
            cwd: m.cwd ?? null,
            model: m.model ?? null,
            turns: m.turns ?? null,
            first: m.first ?? null,
            last: m.last ?? null,
          };
        }),
      ),
    );
    process.exit(0);
  }
  console.log(`${rows.length} session(s)${OPTS.all ? " (all projects)" : ` in ${rows[0]?.project ?? "-"}`}:\n`);
  for (const s of rows.slice(0, 40)) {
    const m = s.size > 400 ? listMeta(s.jsonl, s.size) : {};
    console.log(
      `  ${s.id}  ${iec(s.size).padStart(9)}  ${new Date(s.mtime).toISOString().slice(0, 16).replace("T", " ")}  ${m.title ?? "(untitled)"}`,
    );
  }
  if (!OPTS.all) console.log("\n  --all to list every project");
  process.exit(0);
}

const picked = OPTS.latest ? all[0] : all.find((s) => s.id === target) ?? all.find((s) => s.id.startsWith(target));
if (!picked) {
  console.error(`no session matching "${target}". Run with --list.`);
  process.exit(1);
}

const CLI = picked.id;
const meta = readMeta(picked.jsonl);
const temp = tempDirFor(picked.project, CLI);
const sessionDir = path.join(PROJECTS, picked.project, CLI);
const stage = path.join(os.tmpdir(), `session-export-stage-${CLI.slice(0, 8)}`);
if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// the two root transcripts
fs.copyFileSync(picked.jsonl, path.join(stage, `${CLI}.jsonl`));
fs.copyFileSync(picked.jsonl, path.join(stage, "transcript.jsonl"));

// session folder: subagents, tool-results, workflows all live inside it
const counts = {};
for (const sub of ["subagents", "tool-results", "workflows"]) {
  counts[sub] = copyDir(path.join(sessionDir, sub), path.join(stage, CLI, sub));
}

// logs
counts.logs = 0;
if (OPTS.logs) {
  const dir = LOG_DIRS.find((d) => fs.existsSync(d));
  if (dir) {
    fs.mkdirSync(path.join(stage, "logs"), { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".log")) continue;
      fs.copyFileSync(path.join(dir, f), path.join(stage, "logs", f));
      counts.logs++;
    }
  }
}

// extras — never part of /export, so clearly separated
const excluded = [];
if (OPTS.extras) {
  const ex = path.join(stage, "extras");
  fs.mkdirSync(path.join(ex, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ex, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(ex, "readable"), { recursive: true });

  const tasks = path.join(temp, "tasks");
  counts.tasks = 0;
  if (fs.existsSync(tasks)) {
    for (const f of fs.readdirSync(tasks)) {
      const p = path.join(tasks, f);
      if (!fs.statSync(p).isFile()) continue;
      const sz = fs.statSync(p).size;
      if (OPTS.maxTaskMB > 0 && sz > OPTS.maxTaskMB * 1048576) {
        excluded.push({ f: `tasks/${f}`, size: sz, why: "bulk data, not conversation" });
        continue;
      }
      fs.copyFileSync(p, path.join(ex, "tasks", f));
      counts.tasks++;
    }
  }

  const scratch = path.join(temp, "scratchpad");
  counts.scripts = 0;
  if (fs.existsSync(scratch)) {
    for (const f of fs.readdirSync(scratch)) {
      const p = path.join(scratch, f);
      if (!fs.statSync(p).isFile()) continue;
      if (!/\.(py|mjs|js|sh|html|md|ts)$/.test(f)) continue;
      if (fs.statSync(p).size > 4 * 1048576) continue;
      fs.copyFileSync(p, path.join(ex, "scripts", f));
      counts.scripts++;
    }
  }

  counts.readable = readable(picked.jsonl, path.join(ex, "readable", "session-readable.md"), OPTS.clip);
}

// metadata, in the shape a real export writes; values only where the transcript has them
const ts = (s) => (s ? Date.parse(s) : null);
fs.writeFileSync(
  path.join(stage, "metadata.json"),
  JSON.stringify({
    sessionId: meta.sessionId,
    cliSessionId: CLI,
    cwd: meta.cwd,
    originCwd: meta.cwd,
    lastFocusedAt: ts(meta.last),
    createdAt: ts(meta.first),
    lastActivityAt: ts(meta.last),
    model: meta.model,
    effort: meta.effort,
    sessionSettings: {},
    isArchived: false,
    title: meta.title,
    titleSource: meta.titleSource,
    permissionMode: meta.permissionMode,
    remoteMcpServersConfig: [],
    prs: [],
    chromePermissionMode: null,
    completedTurns: meta.turns,
    lastSpawnRootDetected: false,
    bridgeSessionIds: [],
    remoteControlAutoEligible: false,
    alwaysAllowedReasons: [],
    sessionPermissionUpdates: [],
    classifierSummaryEnabled: null,
    reportFindingsCard: null,
    spawnSeed: {},
    _reconstructed:
      "Rebuilt from the transcript because /export was removed. Keys match a real export; " +
      "values are read from the transcript where it carries them. remoteMcpServersConfig, prs, " +
      "bridgeSessionIds, chromePermissionMode, sessionSettings and spawnSeed are NOT recoverable " +
      "from the transcript and hold empty values rather than guesses.",
  }),
);

fs.writeFileSync(
  path.join(stage, "local-session-state.json"),
  JSON.stringify({ capturedAt: new Date().toISOString(), cliSessionId: CLI, _reconstructed: true }),
);

// readme
const groups = [
  [`${CLI}.jsonl`, 1, fs.statSync(path.join(stage, `${CLI}.jsonl`)).size],
  ["transcript.jsonl", 1, fs.statSync(path.join(stage, "transcript.jsonl")).size],
  [`${CLI}/`, walk(path.join(stage, CLI)).length, walk(path.join(stage, CLI)).reduce((s, f) => s + f.size, 0)],
  ["logs/", walk(path.join(stage, "logs")).length, walk(path.join(stage, "logs")).reduce((s, f) => s + f.size, 0)],
  ["extras/", walk(path.join(stage, "extras")).length, walk(path.join(stage, "extras")).reduce((s, f) => s + f.size, 0)],
];
fs.writeFileSync(
  path.join(stage, "README-EXPORT.md"),
  `# Session export — ${meta.title ?? CLI}

\`${CLI}\` · \`${meta.cwd ?? "?"}\` · ${meta.first?.slice(0, 10)} → ${meta.last?.slice(0, 10)} · ${meta.turns} turns · ${meta.model ?? "?"}${meta.effort ? `, effort ${meta.effort}` : ""}.

Claude Code's \`/export\` was removed; this was rebuilt to the same layout (verified against a
real export archive). Everything above \`extras/\` is what \`/export\` produced.

| Path | Files | Size |
| --- | ---: | ---: |
${groups.map(([n, c, s]) => `| \`${n}\` | ${c} | ${iec(s)} |`).join("\n")}

${
  excluded.length
    ? `## Left out\n\n| File | Size | Why |\n| --- | ---: | --- |\n${excluded
        .map((e) => `| ${e.f} | ${iec(e.size)} | ${e.why} |`)
        .join("\n")}\n\nRe-run with \`--max-task 0\` to keep them.`
    : ""
}

Start with \`extras/readable/session-readable.md\`, then \`${CLI}/subagents/\` for agent work.
\`metadata.json\` is reconstructed — see its \`_reconstructed\` field.
`,
);

const outZip = OPTS.out ?? path.join(process.cwd(), ".exports", `session-export-${CLI.slice(0, 8)}.zip`);
zip(stage, outZip);
fs.rmSync(stage, { recursive: true, force: true });

const zs = fs.statSync(outZip).size;
if (OPTS.json) {
  console.log(
    JSON.stringify({ ok: true, out: outZip, bytes: zs, id: CLI, title: meta.title, turns: meta.turns, cwd: meta.cwd, counts, excluded }),
  );
  process.exit(0);
}
console.log(`\n✔ ${outZip}`);
console.log(`  ${iec(zs)} zipped`);
console.log(`  session  ${CLI}  "${meta.title ?? "(untitled)"}"  ${meta.turns} turns`);
console.log(
  `  contents subagents ${counts.subagents ?? 0} · tool-results ${counts["tool-results"] ?? 0} · workflows ${counts.workflows ?? 0} · logs ${counts.logs}` +
    (OPTS.extras ? ` · tasks ${counts.tasks ?? 0} · scripts ${counts.scripts ?? 0}` : " · no extras"),
);
if (counts.readable)
  console.log(
    `  readable ${counts.readable.users} user msgs · ${counts.readable.replies} replies · ${counts.readable.tools} tool calls`,
  );
if (excluded.length)
  console.log(`  excluded ${excluded.length} oversized task payload(s) — --max-task 0 to keep them`);
