import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProcessTree, START_TOLERANCE, isAlive, parseDmtf, parseElapsed, parseLinuxStat, parsePsSnapshot,
  parseWindowsSnapshot, reapFile, selectTargets} from './process-tree.mjs';
import {Runtime} from './runtime.mjs';

const T = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const taskkillArgs = calls => calls.filter(call => /taskkill/i.test(call.file)).map(call => call.args);

function recorder(results = () => ({code: 0, stdout: '', stderr: ''})) {
  const calls = [];
  return {calls, exec: async (file, args) => { calls.push({file, args}); return results(file, args); }};
}

test('parses Linux stat, ps elapsed time and Windows DMTF snapshots', () => {
  const stat = '4242 (odd) name) S 1 4242 4242 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 1234 0 0';
  assert.deepEqual(parseLinuxStat(stat), {pid: 4242, state: 'S', ppid: 1, pgid: 4242, start: 12340});
  assert.deepEqual(['00:05', '01:02', '1:02:03', '2-01:02:03', 'bad'].map(parseElapsed),
    [5000, 62000, 3723000, 2 * DAY + 3723000, NaN]);
  const ps = parsePsSnapshot('  10     1    10    01:00\nbad line\n  11    10    10 2-00:00:01\n', T);
  assert.deepEqual(ps, [{pid: 10, ppid: 1, pgid: 10, start: T - 60000}, {pid: 11, ppid: 10, pgid: 10, start: T - 2 * DAY - 1000}]);
  // The repeated hour at the end of US daylight time: same local time, one hour apart.
  assert.equal(parseDmtf('20261101013000.000000-300') - parseDmtf('20261101013000.000000-240'), 3600000);
  assert.equal(parseDmtf('20261101013000.250000+000'), Date.UTC(2026, 10, 1, 1, 30, 0, 250));
  assert.deepEqual(parseWindowsSnapshot('0 0 \r\n4 0 \r\n4000 600 20261031120000.000000+540\r\nnoise\r\n'),
    [{pid: 4000, ppid: 600, pgid: null, start: Date.UTC(2026, 9, 31, 3)}]);
});

test('target selection follows groups and parent IDs but rejects reused PIDs', () => {
  const rows = [
    {pid: 4100, ppid: 4000, pgid: 4000, start: T + 100},
    {pid: 4200, ppid: 4100, pgid: 4000, start: T + 200},
    // Child of an earlier process that happened to have the same PID.
    {pid: 4300, ppid: 4000, pgid: 4000, start: T - 10 * START_TOLERANCE},
    // Claims a parent that started after it: the parent PID was reused.
    {pid: 4400, ppid: 4200, pgid: 4400, start: T + 150 - 2 * START_TOLERANCE},
    {pid: 5000, ppid: 1, pgid: 5000, start: T}];
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: true}), {group: 4000, pids: [4100, 4200], reused: false});
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: false}).pids, [4100, 4200]);
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: false}, {exclude: [4100]}).pids, []);
  const reused = [...rows, {pid: 4000, ppid: 1, pgid: 4000, start: T + 60000}];
  assert.deepEqual(selectTargets(reused, {pid: 4000, spawnedAt: T, grouped: true}), {group: null, pids: [], reused: true});
  assert.deepEqual(selectTargets(rows, {pid: 6000, spawnedAt: T, grouped: true}).group, null);
  // Without the launched process, nothing is trusted unless the caller acts right after its owner stopped.
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: true}, {orphans: false}).pids, []);
  assert.deepEqual(selectTargets(rows, {pid: 4000, spawnedAt: T, grouped: false}, {orphans: false}).pids, []);
  assert.equal(isAlive(rows, {pid: 5000, startedAt: T + 1000}), true);
  assert.equal(isAlive(rows, {pid: 5000, startedAt: T + 60000}), false);
  assert.equal(isAlive([{pid: 5000, state: 'Z', start: T}], {pid: 5000, startedAt: T}), false);
});

test('a record from long ago never claims processes started after it', () => {
  // A day-old record of PID 4000: the PID was reused by a process that started children and exited.
  const rows = [{pid: 5000, ppid: 4000, pgid: 4000, start: T + DAY}, {pid: 5100, ppid: 5000, pgid: 4000, start: T + DAY + 10}];
  const old = {pid: 4000, spawnedAt: T, grouped: false};
  assert.deepEqual(selectTargets(rows, {...old, exitedAt: T + 1000}, {now: T + DAY + 20}).pids, []);
  assert.deepEqual(selectTargets(rows, old, {orphans: false, now: T + DAY + 20}).pids, []);
  assert.deepEqual(selectTargets(rows, {...old, grouped: true}, {orphans: false, now: T + DAY + 20}).pids, []);
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
  const pending = rt.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {timeout: 200});
  const pid = [...rt.children][0].pid;
  const start = Date.now();
  await assert.rejects(pending, /timed out/);
  assert.ok(Date.now() - start < 3000);
  assert.deepEqual(taskkillArgs(calls), [['/PID', String(pid), '/T', '/F']]);
  assert.match(calls[0].file, /System32[\\/]taskkill\.exe$/i);
  assert.equal(rt.children.size, 0);
  assert.equal(rt.stoppers.size, 0);
});

test('Windows keeps the pid file entry when stopping the tree cannot be confirmed', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-win-keep-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const state = path.join(dir, 'state');
  const {exec} = recorder(() => ({code: 1, stdout: '', stderr: 'Access is denied.'}));
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => { throw new Error('CIM unavailable'); }});
  const rt = await Runtime.create(dir, {processTree: tree, stateDirectory: state});
  t.after(() => rt.close());
  const pending = rt.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {timeout: 100});
  const pid = [...rt.children][0].pid;
  await assert.rejects(pending, /timed out/);
  await new Promise(resolve => setTimeout(resolve, 50));
  const [file] = (await readdir(state)).filter(name => name.endsWith('.json'));
  const record = JSON.parse(await readFile(path.join(state, file), 'utf8'));
  assert.deepEqual(record.tools.map(tool => tool.pid), [pid]);
  assert.ok(Number.isFinite(record.tools[0].exitedAt), 'exit time bounds a later descendant sweep');
});

test('Windows close falls back to a parent-ID sweep when taskkill /T cannot stop the tree', async () => {
  const rows = [
    {pid: 4000, ppid: 600, start: T + 10},
    {pid: 4100, ppid: 4000, start: T + 100},
    {pid: 4300, ppid: 4000, start: T - 10 * START_TOLERANCE},
    {pid: 5000, ppid: 600, start: T}];
  const {calls, exec} = recorder((file, args) => ({code: args.includes('/T') ? 128 : 0, stdout: '', stderr: ''}));
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows, now: () => T + 1000});
  let killed = 0;
  await tree.stopWindows({pid: 4000, exitCode: null, signalCode: null, kill: () => { killed++; }}, {spawnedAt: T});
  assert.equal(killed, 1);
  assert.deepEqual(taskkillArgs(calls), [['/PID', '4000', '/T', '/F'], ['/F', '/PID', '4000', '/PID', '4100']]);
});

test('Windows sweep stops descendants of a wrapper that already exited', async () => {
  // Windows keeps the exited wrapper's PID as ParentProcessId; taskkill /T cannot start from it.
  const rows = [
    {pid: 4100, ppid: 4000, start: T + 100},
    {pid: 4200, ppid: 4100, start: T + 300},
    {pid: 4300, ppid: 4000, start: T - 10 * START_TOLERANCE},
    // Started after the wrapper exited, so its parent is a new process that reused PID 4000.
    {pid: 4400, ppid: 4000, start: T + 1000 + 2 * START_TOLERANCE},
    {pid: process.pid, ppid: 4000, start: T + 50}];
  const {calls, exec} = recorder();
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows, now: () => T + 60000});
  await tree.stopWindows({pid: 4000, exitCode: 0, signalCode: null, kill: () => assert.fail('wrapper already exited')},
    {spawnedAt: T, exitedAt: T + 1000});
  assert.deepEqual(taskkillArgs(calls), [['/F', '/PID', '4100', '/PID', '4200']]);
});

test('Windows reaper kills only identifiable recorded trees, in bounded batches', async () => {
  const rows = [{pid: 7000, ppid: 1, start: T + 60000}];
  for (let i = 0; i < 40; i++) rows.push({pid: 4001 + i, ppid: 4000 + i, start: T + i});
  const {calls, exec} = recorder();
  const tree = new ProcessTree({platform: 'win32', exec, snapshot: async () => rows, now: () => T + 100});
  const stopped = await tree.reap([{pid: 4000, spawnedAt: T, grouped: false}, {pid: 7000, spawnedAt: T, grouped: false}]);
  assert.deepEqual(stopped.map(row => row.pid), [4000]);
  const batches = taskkillArgs(calls);
  assert.deepEqual(batches.map(args => args.filter(arg => arg !== '/F' && arg !== '/PID').length), [32, 8]);
  assert.ok(batches.flat().every(arg => arg !== '7000' && arg !== '/T'));
});

test('Windows snapshot uses PowerShell WMI output and reports failure', async () => {
  const {calls, exec} = recorder(() => ({code: 0, stdout: '4000 600 20261031120000.000000+000\r\n', stderr: ''}));
  const rows = await new ProcessTree({platform: 'win32', exec}).snapshot();
  assert.deepEqual(rows, [{pid: 4000, ppid: 600, pgid: null, start: Date.UTC(2026, 9, 31, 12)}]);
  assert.match(calls[0].file, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
  assert.match(calls[0].args.at(-1), /Get-WmiObject Win32_Process/);
  const failing = new ProcessTree({platform: 'win32', exec: async () => ({code: 1, stdout: '', stderr: 'denied'})});
  await assert.rejects(failing.snapshot(), /denied/);
});

test('POSIX reaper escalates to KILL only while an identified member remains', async () => {
  const sent = [];
  const snapshots = [
    [{pid: 4100, ppid: 1, pgid: 4000, start: T + 100}, {pid: 4500, ppid: 1, pgid: 4500, start: T + 100},
      {pid: 9000, ppid: 1, pgid: 9000, start: T + 60000}],
    // Group 4500 exited on TERM and its ID now belongs to an unrelated new group.
    [{pid: 4100, ppid: 1, pgid: 4000, start: T + 100}, {pid: 4500, ppid: 1, pgid: 4500, start: T + 30000}]];
  const tree = new ProcessTree({platform: 'darwin', kill: (pid, signal) => sent.push([pid, signal]), wait: async () => sent.push('wait'),
    snapshot: async () => snapshots.shift(), now: () => T + 200});
  await tree.reap([{pid: 4000, spawnedAt: T, grouped: true}, {pid: 4500, spawnedAt: T, grouped: true},
    {pid: 9000, spawnedAt: T, grouped: true}]);
  assert.deepEqual(sent, [[-4000, 'SIGTERM'], [-4500, 'SIGTERM'], 'wait', [-4000, 'SIGKILL']]);
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
  assert.deepEqual(await readdir(state), []);
});

test('the reaper keeps a record it could not act on and drops malformed ones', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-reap-file-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'server-10-1.json');
  const record = JSON.stringify({version: 2, boot: 'b', server: {pid: 10, startedAt: T}, tools: [{pid: 4000, spawnedAt: T, grouped: false}]});
  await writeFile(file, record);
  const failing = new ProcessTree({platform: 'win32', snapshot: async () => { throw new Error('CIM unavailable'); }});
  assert.deepEqual(await reapFile(file, failing), {kept: true});
  assert.equal(await readFile(file, 'utf8'), record);
  const {calls, exec} = recorder();
  const working = new ProcessTree({platform: 'win32', exec, snapshot: async () => [{pid: 4000, ppid: 1, start: T}], now: () => T});
  assert.deepEqual(await reapFile(file, working), {kept: false});
  assert.deepEqual(taskkillArgs(calls), [['/F', '/PID', '4000']]);
  await assert.rejects(readFile(file), /ENOENT/);
  await writeFile(file, '{"version": 2}');
  assert.deepEqual(await reapFile(file, working), {kept: false});
  await assert.rejects(readFile(file), /ENOENT/);
});
