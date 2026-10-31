import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProcessTree, START_TOLERANCE, isAlive, parseLinuxStat, parsePsSnapshot, parseWindowsSnapshot,
  selectTargets} from './process-tree.mjs';
import {Runtime} from './runtime.mjs';

const T = 1_800_000_000_000;
const taskkillArgs = calls => calls.filter(call => /taskkill/i.test(call.file)).map(call => call.args);

function recorder(results = () => ({code: 0, stdout: '', stderr: ''})) {
  const calls = [];
  return {calls, exec: async (file, args) => { calls.push({file, args}); return results(file, args); }};
}

test('parses Linux stat, ps and Windows CIM snapshots', () => {
  const stat = '4242 (odd) name) S 1 4242 4242 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 1234 0 0';
  assert.deepEqual(parseLinuxStat(stat, T), {pid: 4242, state: 'S', ppid: 1, pgid: 4242, start: T + 12340});
  const ps = parsePsSnapshot('  10     1    10 Sat Oct 31 12:00:00 2026\nbad line\n  11    10    10 Sat Oct 31 12:00:01 2026\n');
  assert.deepEqual(ps.map(row => [row.pid, row.ppid, row.pgid]), [[10, 1, 10], [11, 10, 10]]);
  assert.equal(ps[1].start - ps[0].start, 1000);
  assert.deepEqual(parseWindowsSnapshot(`4 0 ${T}\r\n\r\n4000 600 ${T + 5}\r\nnoise\r\n`),
    [{pid: 4, ppid: 0, pgid: null, start: T}, {pid: 4000, ppid: 600, pgid: null, start: T + 5}]);
});

test('target selection follows groups and parent IDs but rejects reused PIDs', () => {
  const rows = [
    {pid: 4100, ppid: 4000, pgid: 4000, start: T + 100},
    {pid: 4200, ppid: 4100, pgid: 4000, start: T + 200},
    // Child of an earlier process that happened to have the same PID.
    {pid: 4300, ppid: 4000, pgid: 4000, start: T - 10 * START_TOLERANCE},
    {pid: 5000, ppid: 1, pgid: 5000, start: T}];
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: true}), {group: 4000, pids: [4100, 4200], reused: false});
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: false}).pids, [4100, 4200]);
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: false}, {exclude: [4100]}).pids, []);
  const reused = [...rows, {pid: 4000, ppid: 1, pgid: 4000, start: T + 60000}];
  assert.deepEqual(selectTargets(reused, {pid: 4000, spawnedAt: T, grouped: true}), {group: null, pids: [], reused: true});
  assert.deepEqual(selectTargets(rows, {pid: 6000, spawnedAt: T, grouped: true}).group, null);
  assert.equal(isAlive(rows, {pid: 5000, startedAt: T + 1000}), true);
  assert.equal(isAlive(rows, {pid: 5000, startedAt: T + 60000}), false);
  assert.equal(isAlive([{pid: 5000, state: 'Z', start: T}], {pid: 5000, startedAt: T}), false);
});

test('Windows runtime stops a timed-out tool tree with taskkill /T /F', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-win-sim-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const {calls, exec} = recorder((file, args) => {
    // Stand-in for taskkill: terminate the simulated root so the wrapper can settle.
    if (/taskkill/i.test(file)) process.kill(Number(args[1]), 'SIGKILL');
    return {code: 0, stdout: '', stderr: ''};
  });
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => { throw new Error('not needed'); }});
  const rt = await Runtime.create(dir, {processTree: tree, registry: false});
  t.after(() => rt.close());
  let pid;
  const pending = rt.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {timeout: 200});
  pid = [...rt.children][0].pid;
  const start = Date.now();
  await assert.rejects(pending, /timed out/);
  assert.ok(Date.now() - start < 3000);
  assert.deepEqual(taskkillArgs(calls), [['/PID', String(pid), '/T', '/F']]);
  assert.match(calls[0].file, /System32[\\/]taskkill\.exe$/i);
  assert.equal(rt.children.size, 0);
  assert.equal(rt.stoppers.size, 0);
});

test('Windows close falls back to a parent-ID sweep when taskkill /T cannot stop the tree', async () => {
  const rows = [
    {pid: 4000, ppid: 600, start: T + 10},
    {pid: 4100, ppid: 4000, start: T + 100},
    {pid: 4300, ppid: 4000, start: T - 10 * START_TOLERANCE},
    {pid: 5000, ppid: 600, start: T}];
  const {calls, exec} = recorder((file, args) => ({code: args.includes('/T') ? 128 : 0, stdout: '', stderr: ''}));
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows});
  let killed = 0;
  await tree.stopWindows({pid: 4000, exitCode: null, signalCode: null, kill: () => { killed++; }}, T);
  assert.equal(killed, 1);
  assert.deepEqual(taskkillArgs(calls), [['/PID', '4000', '/T', '/F'], ['/F', '/PID', '4000', '/PID', '4100']]);
});

test('Windows sweep stops descendants of a wrapper that already exited', async () => {
  // Windows keeps the exited wrapper's PID as ParentProcessId; taskkill /T cannot start from it.
  const rows = [
    {pid: 4100, ppid: 4000, start: T + 100},
    {pid: 4200, ppid: 4100, start: T + 300},
    {pid: 4300, ppid: 4000, start: T - 10 * START_TOLERANCE},
    {pid: process.pid, ppid: 4000, start: T + 50}];
  const {calls, exec} = recorder();
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows});
  await tree.stopWindows({pid: 4000, exitCode: 0, signalCode: null, kill: () => assert.fail('wrapper already exited')}, T);
  assert.deepEqual(taskkillArgs(calls), [['/F', '/PID', '4100', '/PID', '4200']]);
});

test('Windows reaper kills only identifiable recorded trees, in bounded batches', async () => {
  const rows = [{pid: 7000, ppid: 1, start: T + 60000}];
  for (let i = 0; i < 40; i++) rows.push({pid: 4001 + i, ppid: i ? 4000 + i : 4000, start: T + i});
  const {calls, exec} = recorder();
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows});
  const stopped = await tree.reap([{pid: 4000, spawnedAt: T, grouped: false}, {pid: 7000, spawnedAt: T, grouped: false}]);
  assert.deepEqual(stopped.map(row => row.pid), [4000]);
  const batches = taskkillArgs(calls);
  assert.deepEqual(batches.map(args => args.filter(arg => arg !== '/F' && arg !== '/PID').length), [32, 8]);
  assert.ok(batches.flat().every(arg => arg !== '7000' && arg !== '/T'));
});

test('Windows snapshot uses PowerShell CIM output and reports failure', async () => {
  const {calls, exec} = recorder(() => ({code: 0, stdout: `4000 600 ${T}\r\n`, stderr: ''}));
  const rows = await new ProcessTree({platform: 'win32', exec}).snapshot();
  assert.deepEqual(rows, [{pid: 4000, ppid: 600, pgid: null, start: T}]);
  assert.match(calls[0].file, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
  assert.match(calls[0].args.at(-1), /Win32_Process/);
  const failing = new ProcessTree({platform: 'win32', exec: async () => ({code: 1, stdout: '', stderr: 'denied'})});
  await assert.rejects(failing.snapshot(), /denied/);
});

test('POSIX reaper sends TERM then KILL to each identified group', async () => {
  const sent = [];
  const tree = new ProcessTree({platform: 'darwin', kill: (pid, signal) => sent.push([pid, signal]), wait: async () => sent.push('wait'),
    snapshot: async () => [{pid: 4100, ppid: 1, pgid: 4000, start: T + 100}, {pid: 9000, ppid: 1, pgid: 9000, start: T + 60000}]});
  await tree.reap([{pid: 4000, spawnedAt: T, grouped: true}, {pid: 9000, spawnedAt: T, grouped: true}]);
  assert.deepEqual(sent, [[-4000, 'SIGTERM'], 'wait', [-4000, 'SIGKILL']]);
});

test('an unsafe state directory disables the pid file without blocking tools', {skip: process.platform === 'win32'}, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-state-mode-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const state = path.join(dir, 'state');
  await mkdir(state);
  await chmod(state, 0o777);
  const rt = await Runtime.create(dir, {stateDirectory: state});
  t.after(() => rt.close());
  assert.equal(rt.registry, undefined);
  assert.match(rt.registryError, /private/);
  assert.equal((await rt.run(process.execPath, ['-e', 'console.log("ok")'])).stdout.trim(), 'ok');
  await assert.rejects(readFile(path.join(state, 'x')), /ENOENT/);
});
