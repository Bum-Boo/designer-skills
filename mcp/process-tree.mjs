import {execFile, spawn} from 'node:child_process';
import {lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Process start times are compared with the moment a tool was spawned. ps and /proc report
// whole seconds, so allow a few seconds either side while still rejecting reused PIDs.
export const START_TOLERANCE = 5000;
const USER_HZ = 100; // Linux reports /proc starttime in USER_HZ, fixed at 100 on supported architectures.
const reaperScript = fileURLToPath(new URL('./reaper.mjs', import.meta.url));
const system32 = name => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
const TASKKILL = system32('taskkill.exe');
const POWERSHELL = system32('WindowsPowerShell\\v1.0\\powershell.exe');
// Windows does not reparent orphans, so ParentProcessId still names a wrapper that has exited.
const WINDOWS_SNAPSHOT = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | ForEach-Object { " +
  "if ($_.CreationDate) { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, " +
  "([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }";

export function execText(file, args, {timeout = 15000} = {}) {
  return new Promise(resolve => {
    execFile(file, args, {timeout, windowsHide: true, env: {...process.env, LC_ALL: 'C'}, maxBuffer: 16 * 1024 * 1024},
      (error, stdout, stderr) => resolve({code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout: String(stdout), stderr: String(stderr), error}));
  });
}

export function parseLinuxStat(text, bootMs) {
  const close = text.lastIndexOf(')');
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return {pid: Number(text.slice(0, text.indexOf(' '))), state: fields[0], ppid: Number(fields[1]),
    pgid: Number(fields[2]), start: bootMs + Number(fields[19]) * 1000 / USER_HZ};
}

export function parsePsSnapshot(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*\S)\s*$/.exec(line);
    if (!match) continue;
    const start = Date.parse(match[4]);
    if (Number.isFinite(start)) rows.push({pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start});
  }
  return rows;
}

export function parseWindowsSnapshot(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s*$/.exec(line);
    if (match) rows.push({pid: Number(match[1]), ppid: Number(match[2]), pgid: null, start: Number(match[3])});
  }
  return rows;
}

async function linuxSnapshot() {
  const boot = /^btime\s+(\d+)$/m.exec(await readFile('/proc/stat', 'utf8'));
  if (!boot) throw new Error('Linux boot time unavailable');
  const rows = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { rows.push(parseLinuxStat(await readFile(`/proc/${name}/stat`, 'utf8'), Number(boot[1]) * 1000)); }
    catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return rows;
}

/** Select the processes that still belong to a recorded tool launch; never a reused PID. */
export function selectTargets(rows, entry, {exclude = []} = {}) {
  const near = row => Math.abs(row.start - entry.spawnedAt) <= START_TOLERANCE;
  const later = row => row.start >= entry.spawnedAt - START_TOLERANCE;
  const skip = new Set([0, 1, ...exclude]);
  const leader = rows.find(row => row.pid === entry.pid);
  if (leader && !near(leader)) return {group: null, pids: [], reused: true};
  if (entry.grouped) {
    // A live group ID cannot be reassigned, so remaining members are ours even after the leader exits.
    const members = rows.filter(row => row.pgid === entry.pid && later(row) && !skip.has(row.pid));
    return {group: members.length ? entry.pid : null, pids: members.map(row => row.pid), reused: false};
  }
  const pids = leader ? [leader.pid] : [];
  const queue = [entry.pid], seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.ppid !== parent || seen.has(row.pid) || skip.has(row.pid) || !later(row)) continue;
      seen.add(row.pid);
      pids.push(row.pid);
      queue.push(row.pid);
    }
  }
  return {group: null, pids, reused: false};
}

export function isAlive(rows, {pid, startedAt}) {
  return rows.some(row => row.pid === pid && row.state !== 'Z' && Math.abs(row.start - startedAt) <= START_TOLERANCE);
}

/** Platform-specific termination of a launched tool and the processes it started. */
export class ProcessTree {
  constructor({platform = process.platform, exec = execText, kill = (pid, signal) => process.kill(pid, signal),
    snapshot, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    this.platform = platform;
    this.exec = exec;
    this.kill = kill;
    this.wait = wait;
    this.snapshotImpl = snapshot;
  }
  /** POSIX tools run in their own process group; Windows tools are tracked by parent process ID. */
  get grouped() { return this.platform !== 'win32'; }
  async snapshot() {
    if (this.snapshotImpl) return this.snapshotImpl();
    if (this.platform === 'linux') return linuxSnapshot();
    if (this.platform === 'win32') {
      const result = await this.exec(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SNAPSHOT]);
      if (result.code !== 0) throw new Error(`Process snapshot failed: ${result.stderr.trim() || result.code}`);
      return parseWindowsSnapshot(result.stdout);
    }
    const result = await this.exec('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart=']);
    if (result.code !== 0) throw new Error(`Process snapshot failed: ${result.stderr.trim() || result.code}`);
    return parsePsSnapshot(result.stdout);
  }
  /** Signal a running child. Returns a synchronous error to report; Windows work continues asynchronously. */
  signal(child, spawnedAt, force) {
    if (!child.pid) return;
    if (!this.grouped) {
      this.stopWindows(child, spawnedAt).catch(() => {});
      return;
    }
    try { this.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') return error; }
  }
  async stopWindows(child, spawnedAt) {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited && (await this.exec(TASKKILL, ['/PID', String(child.pid), '/T', '/F'])).code === 0) return;
    // taskkill cannot walk from a wrapper that already exited; find descendants by recorded parent ID.
    if (!exited) { try { child.kill(); } catch {} }
    const {pids} = selectTargets(await this.snapshot(), {pid: child.pid, spawnedAt, grouped: false},
      {exclude: [process.pid]});
    await this.taskkill(pids.filter(pid => pid !== child.pid || !exited));
  }
  async taskkill(pids) {
    for (let i = 0; i < pids.length; i += 32) {
      await this.exec(TASKKILL, ['/F', ...pids.slice(i, i + 32).flatMap(pid => ['/PID', String(pid)])]);
    }
  }
  /** Stop every recorded tool launch that is still identifiable. */
  async reap(tools) {
    if (!tools.length) return [];
    const rows = await this.snapshot();
    const stopped = [];
    const groups = [];
    for (const tool of tools) {
      const targets = selectTargets(rows, tool, {exclude: [process.pid]});
      if (!targets.pids.length) continue;
      stopped.push({pid: tool.pid, pids: targets.pids});
      if (this.grouped) groups.push(targets.group);
      else await this.taskkill(targets.pids);
    }
    if (groups.length) {
      const send = signal => { for (const group of groups) { try { this.kill(-group, signal); } catch {} } };
      send('SIGTERM');
      await this.wait(500);
      send('SIGKILL');
    }
    return stopped;
  }
}

export function defaultStateDirectory() {
  return path.join(os.tmpdir(), process.platform === 'win32' ? 'designer-tools-mcp' : `designer-tools-mcp-${process.getuid()}`);
}

function privateDirectory(directory) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = lstatSync(directory);
  if (!stat.isDirectory()) throw new Error('Process state path is not a directory');
  if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) {
    throw new Error('Process state directory must be private to the current user');
  }
}

function validRecord(value) {
  const id = n => Number.isSafeInteger(n) && n > 1;
  return value && typeof value === 'object' && value.version === 1 && value.server && id(value.server.pid) &&
    Number.isFinite(value.server.startedAt) && Array.isArray(value.tools) &&
    value.tools.every(tool => tool && id(tool.pid) && Number.isFinite(tool.spawnedAt) && typeof tool.grouped === 'boolean');
}

export function readRecord(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!validRecord(value)) throw new Error('Malformed process record');
  return value;
}

/**
 * Pid file of running tools for one server, plus a detached reaper that outlives a hard kill.
 * The reaper waits for its stdin pipe to close, which happens however the server process ends.
 */
export class ToolRegistry {
  constructor({directory = defaultStateDirectory(), tree = new ProcessTree(), startReaper = true} = {}) {
    privateDirectory(directory);
    this.directory = directory;
    this.server = {pid: process.pid, startedAt: Date.now() - process.uptime() * 1000};
    this.file = path.join(directory, `server-${process.pid}-${Math.round(this.server.startedAt)}.json`);
    this.tree = tree;
    this.tools = new Map();
    this.closed = false;
    this.startReaper = startReaper;
  }
  write() {
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify({version: 1, server: this.server, tools: [...this.tools.values()]}), {mode: 0o600});
    renameSync(temp, this.file);
  }
  add(tool) {
    if (this.closed) return;
    this.tools.set(tool.pid, tool);
    try {
      this.write();
      if (this.startReaper && !this.reaper) this.spawnReaper();
    } catch {}
  }
  delete(pid) {
    if (!this.tools.delete(pid) || this.closed) return;
    try { this.write(); } catch {}
  }
  spawnReaper() {
    this.reaper = spawn(process.execPath, [reaperScript, this.file], {detached: this.tree.grouped,
      stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true});
    this.reaper.on('error', () => {});
    this.reaper.stdin.on('error', () => {});
    this.reaper.unref();
    this.reaper.stdin.unref?.();
  }
  /** After close the reaper stops what remains and removes the record. */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.reaper) this.reaper.stdin.end();
    else try { unlinkSync(this.file); } catch {}
  }
}

/** Reap tool processes recorded by servers that are no longer running. */
export async function sweepStale({directory = defaultStateDirectory(), tree = new ProcessTree()} = {}) {
  let names;
  try { names = readdirSync(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = names.filter(name => /^server-\d+-\d+\.json$/.test(name)).map(name => path.join(directory, name));
  if (!files.length) return [];
  const rows = await tree.snapshot();
  const stopped = [];
  for (const file of files) {
    let record;
    try { record = readRecord(file); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      try { unlinkSync(file); } catch {}
      continue;
    }
    if (record.server.pid === process.pid || isAlive(rows, record.server)) continue;
    stopped.push(...await tree.reap(record.tools));
    try { unlinkSync(file); } catch {}
  }
  return stopped;
}
