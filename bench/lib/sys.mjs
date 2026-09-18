// Machine + process-tree measurements (Windows). Nothing identifying is recorded: no hostname,
// no user name, no paths.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

function ps(cmd) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function machineInfo() {
  const cpus = os.cpus();
  let disk = null, power = null, osCaption = null;
  try { disk = ps("(Get-PhysicalDisk | Select-Object -First 1 | ForEach-Object { \"$($_.MediaType) $($_.BusType)\" })"); } catch {}
  try { power = ps('(Get-CimInstance Win32_Battery).BatteryStatus') === '2' ? 'AC' : 'battery'; } catch { power = 'unknown'; }
  try { osCaption = ps('(Get-CimInstance Win32_OperatingSystem).Caption'); } catch {}
  return {
    cpu: cpus[0].model.trim(), logicalCores: cpus.length,
    ramGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    os: `${osCaption || os.type()} ${os.release()}`, arch: os.arch(), disk, power, node: process.version,
  };
}

/** Free RAM + whole-machine CPU load sampled over ~2 s — recorded around every suite. */
export function loadSnapshot() {
  let cpuPct = null;
  try { cpuPct = +(+ps("(Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 2).CounterSamples | Measure-Object CookedValue -Average | ForEach-Object Average")).toFixed(1); } catch {}
  return { at: new Date().toISOString(), freeRamGB: +(os.freemem() / 2 ** 30).toFixed(2), cpuLoadPct: cpuPct };
}

/** Sum memory + CPU time over a process and all its descendants. */
export function treeStats(rootPid) {
  const rows = JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime | ConvertTo-Json -Compress'));
  const kids = new Map();
  for (const r of rows) (kids.get(r.ParentProcessId) ?? kids.set(r.ParentProcessId, []).get(r.ParentProcessId)).push(r);
  const byPid = new Map(rows.map((r) => [r.ProcessId, r]));
  const out = { processes: 0, workingSetMB: 0, privateMB: 0, cpuMs: 0 };
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    const r = byPid.get(pid);
    if (!r) continue;
    out.processes++;
    out.workingSetMB += Number(r.WorkingSetSize) / 2 ** 20;
    out.privateMB += Number(r.PrivatePageCount) / 2 ** 20;
    out.cpuMs += (Number(r.KernelModeTime) + Number(r.UserModeTime)) / 1e4; // 100 ns units
    for (const k of kids.get(pid) || []) stack.push(k.ProcessId);
  }
  out.workingSetMB = +out.workingSetMB.toFixed(1);
  out.privateMB = +out.privateMB.toFixed(1);
  out.cpuMs = Math.round(out.cpuMs);
  return out;
}

export function killTree(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
}

export function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const r = (n) => +n.toFixed(1);
  return { median: r(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2), min: r(s[0]), max: r(s[s.length - 1]), runs: xs.map(r) };
}
