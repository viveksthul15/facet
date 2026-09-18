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
 *   --cache <file>     remember --list results here, keyed by path + size + mtime (Facet passes
 *                      one); an unchanged transcript is then never re-read
 *   --json             machine-readable output — a session array for --list, a summary for an
 *                      export. Suppresses the human output so stdout stays parseable.
 *
 * Vendored into Facet from ~/.claude/skills/session-export/export.mjs. The two have diverged:
 * this copy adds --json, --logs-dir, --cache, the in-process zip writer and the sampled listing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// Compression runs on the libuv pool; the default of 4 threads leaves most laptops half idle.
// Must be set before the pool is first used.
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(4, Math.min(os.cpus().length, 12)));

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
  cache: val("--cache", null),
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

/**
 * Call fn(line) for every line of the first `size` bytes of a file, without ever holding the
 * whole file as one string (V8 refuses strings over ~512 MB, and real transcripts get there).
 * Splitting on the 0x0A byte is UTF-8 safe: it never occurs inside a multi-byte sequence.
 */
function eachLine(file, size, fn) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(Math.max(1, Math.min(size, 8 * 1048576)));
    let carry = null;
    let pos = 0;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(10, start);
        if (nl < 0 || nl >= n) break;
        if (carry) {
          fn(Buffer.concat([carry, buf.subarray(start, nl)]).toString("utf8"));
          carry = null;
        } else fn(buf.toString("utf8", start, nl));
        start = nl + 1;
      }
      if (start < n) {
        const rest = Buffer.from(buf.subarray(start, n));
        carry = carry ? Buffer.concat([carry, rest]) : rest;
      }
    }
    if (carry) fn(carry.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

const newMeta = () => ({
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
});

/** Fold one parsed transcript line into the metadata. Never guessed. */
function eatMeta(m, j) {
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

/**
 * Metadata for --list. Small transcripts are read whole and are exact; anything over HEAD+TAIL
 * bytes is sampled from both ends — the head carries cwd, model and the ai-title, the tail the
 * last timestamp and any title set later — and reports turns as null rather than a wrong number.
 *
 * Parsing every line is what made listing slow, and almost none of it is needed: `first` is
 * settled by the first line with a timestamp, `last`/`cwd`/`model` by the last ones, and titles
 * and turns only by lines that mention them. So lines are located as byte ranges, and only the
 * ones that can matter are decoded and parsed. The answer is the same as parsing all of them
 * (checked against the 0.1.2 implementation on randomised transcripts — bench/verify-export.mjs),
 * assuming what Claude Code actually writes: JSON.stringify output, keys not \u-escaped.
 */
const LIST_HEAD = 512 * 1024;
const LIST_TAIL = 256 * 1024;
const NEEDLE_TITLE = Buffer.from('-title"');
const NEEDLE_USER = Buffer.from('"user"');
const NEEDLE_MODEL = Buffer.from('"model"');

/** Flat [start, end, start, end, …] byte ranges of each line in buf. */
function lineRanges(buf, dropFirst, dropLast) {
  const r = [];
  let start = 0;
  for (;;) {
    const nl = buf.indexOf(10, start);
    if (nl < 0) break;
    r.push(start, nl);
    start = nl + 1;
  }
  r.push(start, buf.length);
  if (dropLast) r.length -= 2; //  a head slice ends mid-line
  if (dropFirst) r.splice(0, 2); // a tail slice starts mid-line
  return r;
}

/** Indices of the lines that contain needle, ascending. */
function linesWith(buf, ranges, needle) {
  const hits = [];
  const count = ranges.length / 2;
  let li = 0;
  let at = buf.indexOf(needle, 0);
  while (at >= 0) {
    while (li < count && ranges[li * 2 + 1] <= at) li++;
    if (li >= count) break;
    let next = at + 1;
    // A needle can never span a newline, so a hit at or after the line's start lies inside it.
    if (at >= ranges[li * 2]) {
      hits.push(li);
      next = ranges[li * 2 + 1]; // one hit per line is enough
    }
    at = buf.indexOf(needle, next);
  }
  return hits;
}

function listMeta(jsonl, size) {
  const fd = fs.openSync(jsonl, "r");
  const parts = [];
  try {
    if (size <= LIST_HEAD + LIST_TAIL) {
      const b = Buffer.allocUnsafe(size);
      const n = fs.readSync(fd, b, 0, size, 0);
      parts.push({ buf: b.subarray(0, n), first: false, last: false });
    } else {
      const head = Buffer.allocUnsafe(LIST_HEAD);
      fs.readSync(fd, head, 0, LIST_HEAD, 0);
      const tail = Buffer.allocUnsafe(LIST_TAIL);
      fs.readSync(fd, tail, 0, LIST_TAIL, size - LIST_TAIL);
      parts.push({ buf: head, first: false, last: true }, { buf: tail, first: true, last: false });
    }
  } finally {
    fs.closeSync(fd);
  }
  const sampled = parts.length > 1;
  for (const p of parts) p.ranges = lineRanges(p.buf, p.first, p.last);

  const parse = (p, i) => {
    try {
      return JSON.parse(p.buf.toString("utf8", p.ranges[i * 2], p.ranges[i * 2 + 1]));
    } catch {
      return null;
    }
  };
  const m = { cwd: null, model: null, title: null, titleSource: null, first: null, last: null, turns: sampled ? null : 0 };

  // first timestamp: forwards, stop at the first hit
  scan: for (const p of parts) {
    for (let i = 0; i * 2 < p.ranges.length; i++) {
      const j = parse(p, i);
      if (j?.timestamp) {
        m.first = j.timestamp;
        break scan;
      }
    }
  }
  // last timestamp, cwd, model: backwards, stop once all three are known. When only the model
  // is still missing, only lines that mention "model" are worth parsing.
  let needLast = m.first !== null;
  let needCwd = true;
  let needModel = true;
  back: for (let pi = parts.length - 1; pi >= 0; pi--) {
    const p = parts[pi];
    let modelLines = null;
    for (let i = p.ranges.length / 2 - 1; i >= 0; i--) {
      if (!needLast && !needCwd) {
        modelLines ??= new Set(linesWith(p.buf, p.ranges, NEEDLE_MODEL));
        if (!modelLines.has(i)) continue;
      }
      const j = parse(p, i);
      if (!j) continue;
      if (needLast && j.timestamp) {
        m.last = j.timestamp;
        needLast = false;
      }
      if (needCwd && j.cwd) {
        m.cwd = j.cwd;
        needCwd = false;
      }
      if (needModel && j.type === "assistant" && j.message?.model) {
        m.model = j.message.model;
        needModel = false;
      }
      if (!needLast && !needCwd && !needModel) break back;
    }
  }
  // titles (and turns, when the whole file is in hand): forwards over the few lines that qualify
  for (const p of parts) {
    for (const i of linesWith(p.buf, p.ranges, NEEDLE_TITLE)) {
      const j = parse(p, i);
      if (!j) continue;
      if (j.type === "custom-title" && j.customTitle) {
        m.title = j.customTitle;
        m.titleSource = "custom";
      }
      if (j.type === "ai-title" && j.title && m.titleSource !== "custom") {
        m.title = j.title;
        m.titleSource = "auto";
      }
    }
    if (!sampled) {
      for (const i of linesWith(p.buf, p.ranges, NEEDLE_USER)) {
        const j = parse(p, i);
        if (j && j.type === "user" && typeof j.message?.content === "string") m.turns++;
      }
    }
  }
  return m;
}

/** --list rows, re-reading only transcripts whose size or mtime changed since the cached run. */
function listRows(rows) {
  let cache = {};
  if (OPTS.cache) {
    try {
      const c = JSON.parse(fs.readFileSync(OPTS.cache, "utf8"));
      if (c?.v === 1 && c.entries) cache = c.entries;
    } catch {}
  }
  const next = {};
  let dirty = Object.keys(cache).length !== rows.length;
  const out = rows.map((s) => {
    const hit = cache[s.jsonl];
    let m;
    if (hit && hit.size === s.size && hit.mtime === s.mtime) m = hit.meta;
    else {
      m = s.size > 400 ? listMeta(s.jsonl, s.size) : {};
      dirty = true;
    }
    next[s.jsonl] = { size: s.size, mtime: s.mtime, meta: m };
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
  });
  if (OPTS.cache && dirty) {
    try {
      fs.mkdirSync(path.dirname(OPTS.cache), { recursive: true });
      fs.writeFileSync(`${OPTS.cache}.tmp`, JSON.stringify({ v: 1, entries: next }));
      fs.renameSync(`${OPTS.cache}.tmp`, OPTS.cache);
    } catch {}
  }
  return out;
}

// ── readable transcript ──────────────────────────────────────────────────────
/** Builds the Markdown transcript; feed it every parsed line, then call end(). */
function readableWriter(clip) {
  const parts = [];
  const w = { write: (s) => parts.push(s) };
  const cut = (s, n) => {
    const t = String(s ?? "").replace(/\r/g, "");
    return t.length > n ? `${t.slice(0, n)}\n… [${t.length - n} more chars omitted]` : t;
  };
  let users = 0;
  let replies = 0;
  let tools = 0;
  w.write("# Session transcript\n");
  return {
    eat(j) {
      if (j.type === "user" && typeof j.message?.content === "string") {
        const t = j.message.content;
        // harness-injected notices are not things the user typed
        if (/^<(command-name|local-command|system-reminder)/.test(t.trim())) return;
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
    },
    end: () => ({ body: Buffer.from(parts.join(""), "utf8"), counts: { users, replies, tools } }),
  };
}

// ── zip ──────────────────────────────────────────────────────────────────────
// Written in-process. The old route — copy everything to a staging folder, start PowerShell and
// wait for Compress-Archive — was over 90% of an export's wall time. Files are streamed straight
// from where they live; big ones are deflated as independent chunks in parallel on the thread
// pool (each chunk ends on a sync-flush byte boundary, so the pieces concatenate into one valid
// deflate stream — the pigz trick). No dependency, and the same code path on every platform.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = zlib.crc32 // Node 22+; Electron 32 ships Node 20
  ? (buf, crc) => zlib.crc32(buf, crc)
  : (buf, crc = 0) => {
      let c = ~crc;
      for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return ~c >>> 0;
    };

const ZIP_CHUNK = 4 * 1048576;
const ZIP_PARALLEL = Math.max(2, Math.min(os.cpus().length, 8));
const FORCE_ZIP64 = process.env.SESSION_EXPORT_FORCE_ZIP64 === "1"; // test hook
const U32 = 0xffffffff;

const deflateChunk = (buf, last) =>
  new Promise((resolve, reject) =>
    zlib.deflateRaw(buf, last ? {} : { finishFlush: zlib.constants.Z_SYNC_FLUSH }, (e, out) => (e ? reject(e) : resolve(out))),
  );

class ZipWriter {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.rmSync(file);
    this.fd = fs.openSync(file, "w+");
    this.pos = 0;
    this.entries = [];
  }

  #write(buf, at = null) {
    fs.writeSync(this.fd, buf, 0, buf.length, at ?? this.pos);
    if (at === null) this.pos += buf.length;
  }

  #localHeader(e) {
    const name = Buffer.from(e.name, "utf8");
    const h = Buffer.alloc(30 + name.length + (e.zip64 ? 20 : 0));
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(e.zip64 ? 45 : 20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(e.method, 8);
    h.writeUInt16LE(e.time, 10);
    h.writeUInt16LE(e.date, 12);
    h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(e.zip64 ? U32 : e.csize, 18);
    h.writeUInt32LE(e.zip64 ? U32 : e.usize, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(e.zip64 ? 20 : 0, 28);
    name.copy(h, 30);
    if (e.zip64) {
      const x = 30 + name.length;
      h.writeUInt16LE(1, x);
      h.writeUInt16LE(16, x + 2);
      h.writeBigUInt64LE(BigInt(e.usize), x + 4);
      h.writeBigUInt64LE(BigInt(e.csize), x + 12);
    }
    return h;
  }

  #begin(name, mtime, usize, method) {
    const d = mtime.getFullYear() < 1980 ? new Date(1980, 0, 1) : mtime;
    const e = {
      name,
      method,
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
      crc: 0,
      csize: 0,
      usize,
      offset: this.pos,
      zip64: FORCE_ZIP64 || usize >= 0xfff00000,
    };
    this.#write(this.#localHeader(e)); // placeholder — CRC and sizes are patched in by #finish
    return e;
  }

  #finish(e) {
    this.#write(this.#localHeader(e), e.offset);
    this.entries.push(e);
    return e;
  }

  addDir(name) {
    this.#finish(this.#begin(name.endsWith("/") ? name : `${name}/`, new Date(), 0, 0));
  }

  async addBuffer(name, buf, mtime = new Date()) {
    const e = this.#begin(name, mtime, buf.length, 8);
    e.crc = crc32(buf);
    const out = await deflateChunk(buf, true);
    e.csize = out.length;
    this.#write(out);
    return this.#finish(e);
  }

  /** Stream the first `size` bytes of a file in; chunks deflate in parallel and land in order. */
  async addFile(name, file, size = null) {
    const st = fs.statSync(file);
    const total = size ?? st.size;
    const e = this.#begin(name, st.mtime, total, 8);
    const src = fs.openSync(file, "r");
    try {
      const inflight = [];
      let read = 0;
      let crc = 0;
      do {
        const n = Math.min(ZIP_CHUNK, total - read);
        const buf = Buffer.allocUnsafe(n);
        for (let got = 0; got < n; ) {
          const k = fs.readSync(src, buf, got, n - got, read + got);
          if (k <= 0) throw new Error(`${file} shrank while it was being exported`);
          got += k;
        }
        read += n;
        crc = crc32(buf, crc);
        inflight.push(deflateChunk(buf, read >= total));
        if (inflight.length >= ZIP_PARALLEL) {
          const out = await inflight.shift();
          e.csize += out.length;
          this.#write(out);
        }
      } while (read < total);
      for (const p of inflight) {
        const out = await p;
        e.csize += out.length;
        this.#write(out);
      }
      e.crc = crc;
    } finally {
      fs.closeSync(src);
    }
    return this.#finish(e);
  }

  /** A second name for bytes already in the archive — copies the compressed data, no re-deflate. */
  addCopy(name, of) {
    const e = { ...of, name, offset: this.pos };
    const srcData = of.offset + this.#localHeader(of).length;
    this.#write(this.#localHeader(e));
    const buf = Buffer.allocUnsafe(Math.max(1, Math.min(of.csize, 8 * 1048576)));
    for (let done = 0; done < of.csize; ) {
      const n = fs.readSync(this.fd, buf, 0, Math.min(buf.length, of.csize - done), srcData + done);
      this.#write(buf.subarray(0, n));
      done += n;
    }
    this.entries.push(e);
    return e;
  }

  close() {
    const cdStart = this.pos;
    for (const e of this.entries) {
      const name = Buffer.from(e.name, "utf8");
      const big = e.zip64 || e.offset >= U32;
      const h = Buffer.alloc(46 + name.length + (big ? 28 : 0));
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(big ? 45 : 20, 4);
      h.writeUInt16LE(big ? 45 : 20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(big ? U32 : e.csize, 20);
      h.writeUInt32LE(big ? U32 : e.usize, 24);
      h.writeUInt16LE(name.length, 28);
      h.writeUInt16LE(big ? 28 : 0, 30);
      h.writeUInt32LE(e.name.endsWith("/") ? 0x10 : 0, 38);
      h.writeUInt32LE(big ? U32 : e.offset, 42);
      name.copy(h, 46);
      if (big) {
        const x = 46 + name.length;
        h.writeUInt16LE(1, x);
        h.writeUInt16LE(24, x + 2);
        h.writeBigUInt64LE(BigInt(e.usize), x + 4);
        h.writeBigUInt64LE(BigInt(e.csize), x + 12);
        h.writeBigUInt64LE(BigInt(e.offset), x + 20);
      }
      this.#write(h);
    }
    const cdSize = this.pos - cdStart;
    const n = this.entries.length;
    if (FORCE_ZIP64 || n >= 0xffff || cdStart >= U32 || cdSize >= U32) {
      const z = Buffer.alloc(76); // zip64 end-of-central-directory record + its locator
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(n), 24);
      z.writeBigUInt64LE(BigInt(n), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdStart), 48);
      z.writeUInt32LE(0x07064b50, 56);
      z.writeBigUInt64LE(BigInt(this.pos), 64);
      z.writeUInt32LE(1, 72);
      this.#write(z);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(n, 0xffff), 8);
    end.writeUInt16LE(Math.min(n, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, U32), 12);
    end.writeUInt32LE(Math.min(cdStart, U32), 16);
    this.#write(end);
    fs.closeSync(this.fd);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const all = sessions();

if (OPTS.list || (!target && !OPTS.latest)) {
  const rows = OPTS.all ? all : all.filter((s) => s.project === all[0]?.project);
  if (OPTS.json) {
    // No slice — the caller does its own filtering and paging.
    console.log(JSON.stringify(listRows(rows)));
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
const temp = tempDirFor(picked.project, CLI);
const sessionDir = path.join(PROJECTS, picked.project, CLI);
const outZip = OPTS.out ?? path.join(process.cwd(), ".exports", `session-export-${CLI.slice(0, 8)}.zip`);

// A live session keeps appending to its transcript. Everything below works on the bytes that
// existed at this moment, so the metadata, the readable copy and both archived transcripts agree.
const SIZE = fs.statSync(picked.jsonl).size;

// One pass over the transcript feeds both the metadata and the readable Markdown.
const meta = newMeta();
const md = OPTS.extras ? readableWriter(OPTS.clip) : null;
eachLine(picked.jsonl, SIZE, (line) => {
  if (!line.trim()) return;
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (j === null || typeof j !== "object") return; // valid JSON, but not a transcript record
  eatMeta(meta, j);
  md?.eat(j);
});

const zipw = new ZipWriter(outZip);
const added = []; // what the README's contents table counts
const addFile = async (name, file, size = null) => {
  const e = await zipw.addFile(name, file, size);
  added.push({ name, size: e.usize });
  return e;
};
const addTree = async (src, prefix) => {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  const kids = fs.readdirSync(src, { withFileTypes: true });
  if (!kids.length) zipw.addDir(prefix); // an empty folder is still part of the session
  for (const e of kids) {
    if (e.isDirectory()) n += await addTree(path.join(src, e.name), `${prefix}/${e.name}`);
    else {
      await addFile(`${prefix}/${e.name}`, path.join(src, e.name));
      n++;
    }
  }
  return n;
};

// the two root transcripts — compressed once, stored under both names
const root = await addFile(`${CLI}.jsonl`, picked.jsonl, SIZE);
zipw.addCopy("transcript.jsonl", root);
added.push({ name: "transcript.jsonl", size: root.usize });

// session folder: subagents, tool-results, workflows all live inside it
const counts = {};
for (const sub of ["subagents", "tool-results", "workflows"]) {
  counts[sub] = await addTree(path.join(sessionDir, sub), `${CLI}/${sub}`);
}

// logs
counts.logs = 0;
if (OPTS.logs) {
  const dir = LOG_DIRS.find((d) => fs.existsSync(d));
  if (dir) {
    const logs = fs.readdirSync(dir).filter((f) => f.endsWith(".log"));
    if (!logs.length) zipw.addDir("logs");
    for (const f of logs) {
      await addFile(`logs/${f}`, path.join(dir, f));
      counts.logs++;
    }
  }
}

// extras — never part of /export, so clearly separated
const excluded = [];
if (OPTS.extras) {
  const tasks = path.join(temp, "tasks");
  counts.tasks = 0;
  if (fs.existsSync(tasks)) {
    for (const f of fs.readdirSync(tasks)) {
      const p = path.join(tasks, f);
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      if (OPTS.maxTaskMB > 0 && st.size > OPTS.maxTaskMB * 1048576) {
        excluded.push({ f: `tasks/${f}`, size: st.size, why: "bulk data, not conversation" });
        continue;
      }
      await addFile(`extras/tasks/${f}`, p);
      counts.tasks++;
    }
  }
  if (!counts.tasks) zipw.addDir("extras/tasks");

  const scratch = path.join(temp, "scratchpad");
  counts.scripts = 0;
  if (fs.existsSync(scratch)) {
    for (const f of fs.readdirSync(scratch)) {
      const p = path.join(scratch, f);
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      if (!/\.(py|mjs|js|sh|html|md|ts)$/.test(f)) continue;
      if (st.size > 4 * 1048576) continue;
      await addFile(`extras/scripts/${f}`, p);
      counts.scripts++;
    }
  }
  if (!counts.scripts) zipw.addDir("extras/scripts");

  const r = md.end();
  await zipw.addBuffer("extras/readable/session-readable.md", r.body);
  added.push({ name: "extras/readable/session-readable.md", size: r.body.length });
  counts.readable = r.counts;
}

// metadata, in the shape a real export writes; values only where the transcript has them
const ts = (s) => (s ? Date.parse(s) : null);
await zipw.addBuffer(
  "metadata.json",
  Buffer.from(
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
  ),
);

await zipw.addBuffer(
  "local-session-state.json",
  Buffer.from(JSON.stringify({ capturedAt: new Date().toISOString(), cliSessionId: CLI, _reconstructed: true })),
);

// readme
const under = (prefix) => added.filter((a) => a.name.startsWith(prefix));
const group = (label, files) => [label, files.length, files.reduce((s, f) => s + f.size, 0)];
const groups = [
  [`${CLI}.jsonl`, 1, SIZE],
  ["transcript.jsonl", 1, SIZE],
  group(`${CLI}/`, under(`${CLI}/`)),
  group("logs/", under("logs/")),
  group("extras/", under("extras/")),
];
await zipw.addBuffer(
  "README-EXPORT.md",
  Buffer.from(`# Session export — ${meta.title ?? CLI}

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
`),
);
zipw.close();

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
