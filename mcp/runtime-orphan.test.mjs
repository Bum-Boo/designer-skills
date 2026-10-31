import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {ProcessTree, sweepStale} from './process-tree.mjs';

const linux = {skip: process.platform !== 'linux', timeout: 20000};
const runtimeUrl = new URL('./runtime.mjs', import.meta.url).href;

async function running(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await pause(50); }
  return false;
}

async function readPid(file) {
  let pid;
  await until(async () => {
    try { pid = Number(await readFile(file, 'utf8')); return pid > 1; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  });
  return pid;
}

async function scratch(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const state = path.join(dir, 'state');
  const owned = [];
  t.after(async () => {
    for (const pid of owned) { try { if (await running(pid)) process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(dir, {recursive: true, force: true});
  });
  return {dir, state, owned};
}

test('tools stop after the server process group is SIGKILLed', linux, async t => {
  const {dir, state, owned} = await scratch(t, 'designer-hard-kill-');
  const marker = path.join(dir, 'child.pid');
  // Stands in for an MCP server launched by a client in its own process group.
  const server = spawn(process.execPath, ['--input-type=module', '-e', `
    import {Runtime} from ${JSON.stringify(runtimeUrl)};
    const rt = await Runtime.create(${JSON.stringify(dir)}, {stateDirectory: ${JSON.stringify(state)}});
    rt.run('/bin/sh', ['-c', 'sleep 30 & printf "%s" "$!" > "$1"; wait', 'tool', ${JSON.stringify(marker)}]).catch(() => {});
  `], {detached: true, stdio: 'ignore'});
  owned.push(server.pid);
  const pid = await readPid(marker);
  owned.push(pid);
  assert.ok(pid > 1, 'tool must start its descendant');
  assert.equal(await running(pid), true);
  process.kill(-server.pid, 'SIGKILL');
  assert.ok(await until(async () => !(await running(pid))), 'descendant must be stopped after the server is killed');
  assert.ok(await until(async () => (await readdir(state)).length === 0), 'reaper removes the pid file');
});

test('startup sweep stops tools recorded by a dead server and leaves reused PIDs alone', linux, async t => {
  const {state, owned} = await scratch(t, 'designer-sweep-');
  const tree = new ProcessTree();
  const sleeper = () => { const child = spawn('sleep', ['30'], {detached: true, stdio: 'ignore'}); owned.push(child.pid); return child; };
  const ghost = spawn(process.execPath, ['-e', ''], {stdio: 'ignore'});
  const ghostStarted = tree.now();
  await new Promise(resolve => ghost.once('exit', resolve));
  const liveServer = sleeper(), liveStarted = tree.now();
  const stale = sleeper(), reused = sleeper(), live = sleeper(), otherBoot = sleeper();
  // The leader of this group exits at once and leaves its sleep running.
  const orphaned = spawn('/bin/sh', ['-c', 'sleep 30 & exit 0'], {detached: true, stdio: 'ignore'});
  await new Promise(resolve => orphaned.once('exit', resolve));
  const now = tree.now();
  await mkdir(state, {mode: 0o700});
  const write = (name, boot, server, tools) => writeFile(path.join(state, name), JSON.stringify({version: 2, boot, server, tools}));
  await write(`server-${ghost.pid}-1.json`, tree.boot(), {pid: ghost.pid, startedAt: ghostStarted}, [
    {pid: stale.pid, spawnedAt: now, grouped: true},
    // Recorded a minute earlier than the process now holding that PID was created.
    {pid: reused.pid, spawnedAt: now - 60000, grouped: true},
    // Its own process is gone, so the remaining group member cannot be told apart from a reused group.
    {pid: orphaned.pid, spawnedAt: now, grouped: true, exitedAt: now}]);
  await write(`server-${liveServer.pid}-2.json`, tree.boot(), {pid: liveServer.pid, startedAt: liveStarted},
    [{pid: live.pid, spawnedAt: now, grouped: true}]);
  await write(`server-${ghost.pid}-3.json`, 'an-earlier-boot', {pid: ghost.pid, startedAt: ghostStarted},
    [{pid: otherBoot.pid, spawnedAt: now, grouped: true}]);
  await writeFile(path.join(state, 'server-2-4.json'), '{"version": 1, "server": []}');
  await chmod(state, 0o700);
  const groupMember = (await tree.snapshot()).find(row => row.pgid === orphaned.pid);
  assert.ok(groupMember, 'the orphaned group member is running');
  owned.push(groupMember.pid);
  const stopped = await sweepStale({directory: state, tree});
  assert.deepEqual(stopped.map(row => row.pid), [stale.pid]);
  assert.ok(await until(async () => !(await running(stale.pid))));
  assert.equal(await running(reused.pid), true, 'a PID with a different start time is not ours');
  assert.equal(await running(groupMember.pid), true, 'a stale record does not claim members of a leaderless group');
  assert.equal(await running(live.pid), true, 'records of a running server are left alone');
  assert.equal(await running(otherBoot.pid), true, 'records from another boot are never acted on');
  assert.deepEqual(await readdir(state), [`server-${liveServer.pid}-2.json`]);
});

test('closing a runtime removes its pid file and stops its reaper', linux, async t => {
  const {dir, state} = await scratch(t, 'designer-registry-');
  const {Runtime} = await import('./runtime.mjs');
  const rt = await Runtime.create(dir, {stateDirectory: state});
  assert.equal((await rt.run(process.execPath, ['-e', 'console.log("ok")'])).stdout.trim(), 'ok');
  const [file] = await readdir(state);
  assert.deepEqual(JSON.parse(await readFile(path.join(state, file), 'utf8')).tools, []);
  const reaper = rt.registry.reaper.pid;
  rt.close();
  assert.ok(await until(async () => !(await running(reaper))), 'reaper exits after the server closes');
  assert.deepEqual(await readdir(state), []);
});

test('real MCP server: SIGKILL during a tool call does not orphan the tool', linux, async t => {
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const {dir, owned} = await scratch(t, 'designer-server-kill-');
  const marker = path.join(dir, 'child.pid');
  const python = path.join(dir, 'slow-python');
  // Version probe that never answers and leaves a descendant holding the pipes.
  await writeFile(python, `#!/bin/sh\nsleep 30 & printf "%s" "$!" > ${JSON.stringify(marker)}\nwait\n`);
  await chmod(python, 0o755);
  const transport = new StdioClientTransport({command: process.execPath,
    args: [new URL('./server.mjs', import.meta.url).pathname, '--workspace', dir, '--python', python, '--blender', 'designer-blender-missing'],
    stderr: 'pipe'});
  const client = new Client({name: 'designer-kill-test', version: '1.0.0'});
  t.after(() => client.close().catch(() => {}));
  await client.connect(transport);
  client.callTool({name: 'designer_tools_status', arguments: {}}).catch(() => {});
  const pid = await readPid(marker);
  owned.push(pid);
  assert.equal(await running(pid), true);
  process.kill(transport.pid, 'SIGKILL');
  assert.ok(await until(async () => !(await running(pid))), 'tool descendant must stop after the server is SIGKILLed');
});

test('server and tool identity on Linux ignores wall-clock jumps', linux, async t => {
  const {state, owned} = await scratch(t, 'designer-clock-');
  const {ToolRegistry, isAlive, selectTargets} = await import('./process-tree.mjs');
  const tree = new ProcessTree();
  const registry = new ToolRegistry({directory: state, tree, startReaper: false});
  t.after(() => registry.close());
  const tool = spawn('sleep', ['30'], {detached: true, stdio: 'ignore'});
  owned.push(tool.pid);
  const entry = {pid: tool.pid, spawnedAt: tree.now(), grouped: true};
  const realNow = Date.now;
  Date.now = () => realNow() + 3600000; // As after a host resume or a manual clock change.
  try {
    const rows = await tree.snapshot();
    assert.equal(isAlive(rows, registry.server), true, 'this server is still recognised');
    assert.deepEqual(selectTargets(rows, entry, {orphans: false, now: tree.now()}).pids, [tool.pid]);
  } finally { Date.now = realNow; }
});
