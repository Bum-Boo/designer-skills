// Synthetic review harness (2026-10-23) for candidate d91596e Runtime cleanup. Linux only (/proc, /bin/sh).
// Usage: node review/repro_codex_fixes.mjs <candidate-checkout>   (the checkout must have node_modules)
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile, chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

const root = path.resolve(process.argv[2] || '.');
const {Runtime} = await import(pathToFileURL(path.join(root, 'mcp/runtime.mjs')).href);
const record = (id, observed) => console.log(JSON.stringify({id, observed}));
const alive = async pid => {
  try { const s = await readFile(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2)[0] !== 'Z'; }
  catch { return false; }
};
const pidFrom = async file => { for (let i = 0; i < 200; i++) { try { const p = Number(await readFile(file, 'utf8')); if (p > 1) return p; } catch {} await pause(25); } };
const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-review-fix-'));
const cleanup = [];
try {
  const rt = await Runtime.create(dir);
  // 1. Wrapper exits 0 at once but leaves a descendant holding stdout: success must not hang forever.
  let t = Date.now();
  const marker1 = path.join(dir, 'bg.pid');
  const r1 = await rt.run('/bin/sh', ['-c', 'sleep 30 & echo $! > "$1"; echo hi', 'w', marker1], {timeout: 1500}).then(() => 'resolved', e => e.message.slice(0, 40));
  const p1 = await pidFrom(marker1); cleanup.push(p1);
  record('wrapper-exit0-descendant-holds-pipe', {result: r1, seconds: (Date.now() - t) / 1000, descendantAlive: await alive(p1)});
  // 2. Descendant that closes its pipes after a normal exit is not touched on success (documented scope).
  const marker2 = path.join(dir, 'daemon.pid');
  const r2 = await rt.run('/bin/sh', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $! > "$1"', 'w', marker2], {timeout: 5000}).then(() => 'resolved', e => e.message);
  const p2 = await pidFrom(marker2); cleanup.push(p2);
  record('success-leaves-pipe-free-descendant', {result: r2, descendantAlive: await alive(p2)});
  // 3. setsid escape (documented limit).
  const marker3 = path.join(dir, 'escape.pid');
  const r3 = await rt.run('/bin/sh', ['-c', 'setsid sh -c \'echo $$ > "$1"; exec sleep 30\' x "$1"; sleep 30', 'w', marker3], {timeout: 1000}).then(() => 'resolved', e => e.message.slice(0, 40));
  const p3 = await pidFrom(marker3); cleanup.push(p3);
  record('setsid-escape', {result: r3, escapedAlive: await alive(p3)});
  // 4. Repeated close, close with nothing running, missing executable after close.
  const marker4 = path.join(dir, 'close.pid');
  const pending = rt.run('/bin/sh', ['-c', 'trap "" TERM; sleep 30 & echo $! > "$1"; wait', 'w', marker4], {timeout: 20000}).then(() => 'resolved', e => e.message.slice(0, 30));
  const p4 = await pidFrom(marker4); cleanup.push(p4);
  t = Date.now(); rt.close(); rt.close(); rt.close();
  record('repeated-close', {result: await pending, seconds: (Date.now() - t) / 1000, descendantAlive: await alive(p4),
    children: rt.children.size, stoppers: rt.stoppers.size, runAfterClose: await rt.run('x', []).catch(e => e.message)});
  const rt2 = await Runtime.create(dir);
  record('missing-executable', {result: await rt2.run('designer-review-no-such-exe', []).catch(e => e.message), children: rt2.children.size});
  rt2.close(); rt2.close();
  // 5. Server killed with a process-group signal (e.g. a launcher killing its job): detached tool children now survive.
  const marker5 = path.join(dir, 'server-child.pid');
  const wrapper = path.join(dir, 'py.sh');
  await writeFile(wrapper, `#!/bin/sh\necho $$ > "${marker5}"\nexec sleep 30\n`); await chmod(wrapper, 0o755);
  const server = spawn(process.execPath, [path.join(root, 'mcp/server.mjs'), '--workspace', dir, '--python', wrapper, '--blender', 'none'],
    {detached: true, stdio: ['pipe', 'pipe', 'inherit']});
  const send = m => server.stdin.write(JSON.stringify(m) + '\n');
  send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'r', version: '0'}}});
  send({jsonrpc: '2.0', method: 'notifications/initialized'});
  send({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'designer_tools_status', arguments: {}}});
  const p5 = await pidFrom(marker5); cleanup.push(p5);
  process.kill(-server.pid, 'SIGKILL');
  await pause(300);
  record('server-group-sigkill', {serverAlive: await alive(server.pid), toolChildAlive: await alive(p5)});
  // 6. Graceful server stop (stdin end) still cleans the tool group.
  const marker6 = path.join(dir, 'server-child.pid');
  await rm(marker6, {force: true});
  const s2 = spawn(process.execPath, [path.join(root, 'mcp/server.mjs'), '--workspace', dir, '--python', wrapper, '--blender', 'none'], {stdio: ['pipe', 'pipe', 'inherit']});
  s2.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'r', version: '0'}}}) + '\n');
  s2.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  s2.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'designer_tools_status', arguments: {}}}) + '\n');
  const p6 = await pidFrom(marker6); cleanup.push(p6);
  t = Date.now(); s2.stdin.end();
  const exit = await Promise.race([new Promise(r => s2.once('exit', c => r(c))), pause(5000).then(() => 'still running')]);
  record('server-stdin-end', {exit, seconds: (Date.now() - t) / 1000, toolChildAlive: await alive(p6)});
  if (exit === 'still running') s2.kill('SIGKILL');
} finally {
  for (const pid of cleanup) if (pid && await alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
  await rm(dir, {recursive: true, force: true});
}
