import {execFile, spawn} from 'node:child_process';
import {lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Process start times are compared with the moment a tool was spawned, using the clock the
// platform reports start times in: boot-relative on Linux, wall time elsewhere. Allow a few
// seconds either side for second-resolution reports while still rejecting reused PIDs.
export const START_TOLERANCE = 5000;
const USER_HZ = 100; // Linux reports /proc starttime in USER_HZ, fixed at 100 on supported architectures.
const reaperScript = fileURLToPath(new URL('./reaper.mjs', import.meta.url));
const system32 = name => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
const TASKKILL = system32('taskkill.exe');
const POWERSHELL = system32('WindowsPowerShell\\v1.0\\powershell.exe');
// Windows does not reparent orphans, so ParentProcessId still names a wrapper that has exited.
// WMI keeps CreationDate as a DMTF string with its UTC offset, which stays unambiguous across DST.
const WINDOWS_SNAPSHOT = "$ErrorActionPreference='Stop'; Get-WmiObject Win32_Process | ForEach-Object { " +
  "'{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate }";

export function execText(file, args, {timeout = 15000} = {}) {
  return new Promise(resolve => {
    execFile(file, args, {timeout, windowsHide: true, env: {...process.env, LC_ALL: 'C'}, maxBuffer: 16 * 1024 * 1024},
      (error, stdout, stderr) => resolve({code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout: String(stdout), stderr: String(stderr), error}));
  });
}

/** Start time in milliseconds since boot. */
export function parseLinuxStat(text) {
  const close = text.lastIndexOf(')');
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return {pid: Number(text.slice(0, text.indexOf(' '))), state: fields[0], ppid: Number(fields[1]),
    pgid: Number(fields[2]), start: Number(fields[19]) * 1000 / USER_HZ};
}

/** `ps -o etime` is elapsed time ([[dd-]hh:]mm:ss), independent of time zone and DST. */
export function parseElapsed(text) {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!match) return NaN;
  const [days, hours, minutes, seconds] = match.slice(1).map(value => Number(value ?? 0));
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export function parsePsSnapshot(text, now) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    const elapsed = match ? parseElapsed(match[4]) : NaN;
    if (Number.isFinite(elapsed)) rows.push({pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start: now - elapsed});
  }
  return rows;
}

/** DMTF datetime, e.g. 20261101013000.123456-300: local time and its UTC offset in minutes. */
export function parseDmtf(text) {
  const match = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\.(\d{6})([+-]\d{3})$/.exec(text);
  if (!match) return NaN;
  const [year, month, day, hour, minute, second, micro, offset] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(micro / 1000)) - offset * 60000;
}

export function parseWindowsSnapshot(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    const start = match ? parseDmtf(match[3]) : NaN;
    if (Number.isFinite(start)) rows.push({pid: Number(match[1]), ppid: Number(match[2]), pgid: null, start});
  }
  return rows;
}

async function linuxSnapshot() {
  const rows = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { rows.push(parseLinuxStat(await readFile(`/proc/${name}/stat`, 'utf8'))); }
    catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return rows;
}

/**
 * Select the processes that still belong to a recorded tool launch; never a reused PID.
 * When the launched process itself is gone, its group or children are trusted only with
 * `orphans` (cleanup right after the owner stopped) and only within when they could have started.
 */
export function selectTargets(rows, entry, {exclude = [], orphans = true, now = Infinity} = {}) {
  const none = reused => ({group: null, pids: [], reused});
  const skip = new Set([0, 1, ...exclude]);
  const leader = rows.find(row => row.pid === entry.pid);
  if (leader && Math.abs(leader.start - entry.spawnedAt) > START_TOLERANCE) return none(true);
  if (!leader && !orphans) return none(false);
  const earliest = entry.spawnedAt - START_TOLERANCE;
  if (entry.grouped) {
    // A group ID cannot be reassigned while any member is alive.
    const members = rows.filter(row => row.pgid === entry.pid && row.start >= earliest &&
      row.start <= now + START_TOLERANCE && !skip.has(row.pid));
    return {group: members.length ? entry.pid : null, pids: members.map(row => row.pid), reused: false};
  }
  // A child starts after its parent and, for a parent that has exited, before that exit.
  const pids = leader ? [leader.pid] : [];
  const starts = new Map([[entry.pid, leader ? leader.start : entry.spawnedAt]]);
  const latest = leader ? Infinity : (entry.exitedAt ?? now) + START_TOLERANCE;
  const queue = [entry.pid];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.ppid !== parent || starts.has(row.pid) || skip.has(row.pid)) continue;
      if (row.start < Math.max(earliest, starts.get(parent) - START_TOLERANCE)) continue;
      if (parent === entry.pid && row.start > latest) continue;
      starts.set(row.pid, row.start);
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
    snapshot, now, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    this.platform = platform;
    this.exec = exec;
    this.kill = kill;
    this.wait = wait;
    this.snapshotImpl = snapshot;
    this.nowImpl = now;
  }
  /** POSIX tools run in their own process group; Windows tools are tracked by parent process ID. */
  get grouped() { return this.platform !== 'win32'; }
  /** Current time on the clock that snapshots report start times in. */
  now() {
    if (this.nowImpl) return this.nowImpl();
    // The boot clock matches /proc starttime and does not move when the wall clock is set.
    return this.platform === 'linux' ? os.uptime() * 1000 : Date.now();
  }
  /** Identifies the current boot so records from before a restart are never acted on. */
  boot() {
    if (this.platform === 'linux') return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return String(Math.round(Date.now() / 1000 - os.uptime()));
  }
  sameBoot(recorded) {
    if (this.platform === 'linux') return recorded === this.boot();
    return Math.abs(Number(recorded) - Number(this.boot())) <= 120;
  }
  async snapshot() {
    if (this.snapshotImpl) return this.snapshotImpl();
    if (this.platform === 'linux') return linuxSnapshot();
    if (this.platform === 'win32') {
      const result = await this.exec(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SNAPSHOT]);
      if (result.code !== 0) throw new Error(`Process snapshot failed: ${result.stderr.trim() || result.code}`);
      return parseWindowsSnapshot(result.stdout);
    }
    const result = await this.exec('ps', ['-A', '-o', 'pid=,ppid=,pgid=,etime=']);
    if (result.code !== 0) throw new Error(`Process snapshot failed: ${result.stderr.trim() || result.code}`);
    return parsePsSnapshot(result.stdout, this.now());
  }
  /**
   * Signal a running child. POSIX returns {error} for an unexpected failure. Windows returns
   * {pending}: it resolves once the tree is stopped and rejects if that could not be confirmed.
   */
  signal(child, launch, force) {
    if (!child.pid) return {};
    if (!this.grouped) return {pending: this.stopWindows(child, launch)};
    try { this.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') return {error}; }
    return {};
  }
  async stopWindows(child, {spawnedAt, exitedAt}) {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited && (await this.exec(TASKKILL, ['/PID', String(child.pid), '/T', '/F'])).code === 0) return;
    // taskkill cannot walk from a wrapper that already exited; find descendants by recorded parent ID.
    if (!exited) { try { child.kill(); } catch {} }
    const {pids} = selectTargets(await this.snapshot(), {pid: child.pid, spawnedAt, grouped: false, exitedAt},
      {exclude: [process.pid], now: this.now()});
    await this.taskkill(pids.filter(pid => pid !== child.pid || !exited));
  }
  async taskkill(pids) {
    for (let i = 0; i < pids.length; i += 32) {
      await this.exec(TASKKILL, ['/F', ...pids.slice(i, i + 32).flatMap(pid => ['/PID', String(pid)])]);
    }
  }
  identify(rows, tools, orphans) {
    const now = this.now();
    return tools.map(tool => ({tool, ...selectTargets(rows, tool, {exclude: [process.pid], orphans, now})}))
      .filter(targets => targets.pids.length);
  }
  /** Stop every recorded tool launch that is still identifiable. */
  async reap(tools, {orphans = true} = {}) {
    if (!tools.length) return [];
    const rows = await this.snapshot();
    const found = this.identify(rows, tools, orphans);
    if (this.grouped) {
      for (const {group} of found) { try { this.kill(-group, 'SIGTERM'); } catch {} }
      if (found.length) {
        const seen = new Map(rows.map(row => [row.pid, row.start]));
        await this.wait(500);
        // Escalate only while a process identified above is still in the group; an ID reused since is left alone.
        const after = await this.snapshot();
        for (const {group, pids} of found) {
          const remaining = after.some(row => row.pgid === group && pids.includes(row.pid) &&
            Math.abs(row.start - seen.get(row.pid)) <= START_TOLERANCE);
          if (remaining) { try { this.kill(-group, 'SIGKILL'); } catch {} }
        }
      }
    } else {
      for (const {pids} of found) await this.taskkill(pids);
    }
    return found.map(({tool, pids}) => ({pid: tool.pid, pids}));
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
  return value && typeof value === 'object' && value.version === 2 && typeof value.boot === 'string' &&
    value.server && id(value.server.pid) && Number.isFinite(value.server.startedAt) && Array.isArray(value.tools) &&
    value.tools.every(tool => tool && id(tool.pid) && Number.isFinite(tool.spawnedAt) && typeof tool.grouped === 'boolean' &&
      (tool.exitedAt === undefined || Number.isFinite(tool.exitedAt)));
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
    this.tree = tree;
    this.boot = tree.boot();
    this.server = {pid: process.pid, startedAt: tree.now() - process.uptime() * 1000};
    this.file = path.join(directory, `server-${process.pid}-${Date.now()}.json`);
    this.tools = new Map();
    this.closed = false;
    this.startReaper = startReaper;
  }
  write() {
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify({version: 2, boot: this.boot, server: this.server, tools: [...this.tools.values()]}),
      {mode: 0o600});
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
  update(pid, fields) {
    const tool = this.tools.get(pid);
    if (!tool || this.closed) return;
    Object.assign(tool, fields);
    try { this.write(); } catch {}
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
    if (record.server.pid === process.pid) continue;
    // Start times from another boot are meaningless; such records are dropped without signalling.
    if (tree.sameBoot(record.boot)) {
      if (isAlive(rows, record.server)) continue;
      // Long after its owner died, only a launched process that is itself still running is trusted.
      stopped.push(...await tree.reap(record.tools, {orphans: false}));
    }
    try { unlinkSync(file); } catch {}
  }
  return stopped;
}

/** Reaper action for one server's record. A record that could not be acted on is kept for a startup sweep. */
export async function reapFile(file, tree = new ProcessTree()) {
  let record;
  try { record = readRecord(file); }
  catch (error) {
    if (error.code !== 'ENOENT') try { unlinkSync(file); } catch {}
    return {kept: false};
  }
  try { await tree.reap(record.tools); }
  catch { return {kept: true}; }
  try { unlinkSync(file); } catch {}
  return {kept: false};
}
