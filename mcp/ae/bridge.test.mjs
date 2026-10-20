import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { WebSocket } from 'ws';
import { createAeBridge } from './bridge.mjs';

const token = 'test-session-token-'.repeat(3);
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-ae-'));
  const bridge = await createAeBridge({ port: 0, token, jobDirectory: directory, ...options });
  t.after(async () => { await bridge.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { bridge, directory };
}
async function connect(t, bridge, supplied = token) {
  const socket = new WebSocket('ws://127.0.0.1:' + bridge.status().port + '/ae');
  socket.on('error', () => {});
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const response = Promise.race([once(socket, 'message'), once(socket, 'close')]);
  socket.send(JSON.stringify({ token: supplied }));
  await response;
  return socket;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('reject unauthorized handshake and keep authenticated panel', async t => {
  const { bridge } = await fixture(t);
  const bad = await connect(t, bridge, 'wrong');
  assert.equal(bad.readyState, WebSocket.CLOSED);
  assert.equal(bridge.status().connected, false);
  const good = await connect(t, bridge);
  const duplicate = await connect(t, bridge);
  assert.equal(duplicate.readyState, WebSocket.CLOSED);
  assert.equal(good.readyState, WebSocket.OPEN);
  assert.equal(bridge.status().connected, true);
});

test('status diagnostics, input validation, and explicit scripting opt-in', async t => {
  const { bridge } = await fixture(t);
  assert.equal((await bridge.call('ae_status')).native, null);
  assert.equal((await bridge.call('comp_list')).error.code, 'AE_NOT_CONNECTED');
  assert.equal((await bridge.call('run_jsx', { code: 'return 1;' })).error.code, 'SCRIPTS_DISABLED');
  assert.equal((await bridge.call('other')).error.code, 'UNKNOWN_METHOD');
  assert.equal((await bridge.call('comp_list', { extra: true })).error.code, 'BAD_ARGUMENTS');
  assert.equal(JSON.stringify(bridge.status()).includes(token), false);
});

test('serialize real argument/result files and preserve script payload', async t => {
  const { bridge, directory } = await fixture(t, { allowScripts: true });
  const socket = await connect(t, bridge);
  let active = 0;
  let maximum = 0;
  const calls = [];
  socket.on('message', async raw => {
    const job = JSON.parse(String(raw));
    active++;
    maximum = Math.max(maximum, active);
    const args = JSON.parse(await fs.readFile(job.argsPath, 'utf8'));
    calls.push({ job, args });
    assert.equal(path.dirname(job.argsPath), directory);
    await delay(15);
    const result = job.call === 'list_comps' ? { ok: true, comps: [{ id: 1, name: 'MAIN' }] } : { ok: true, value: args.args?.text || '26' };
    await fs.writeFile(job.resultPath, '\uFEFF' + JSON.stringify(result));
    active--;
    socket.send(JSON.stringify({ id: job.id, ok: true }));
  });
  const results = await Promise.all([
    bridge.call('comp_list'),
    bridge.call('run_jsx', { code: 'return args.text;', args: { text: 'line\u2028separator' }, undoLabel: 'Test' }),
    bridge.call('ae_status')
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(calls.map(c => c.job.call), ['list_comps', 'run_jsx', 'status']);
  assert.equal(results[1].value, 'line\u2028separator');
  assert.equal(calls[1].args.code, 'return args.text;');
  assert.equal(results[2].bridge.connected, true);
  assert.equal((await fs.readdir(directory)).length, 6);
});

test('disconnect before dispatch removes owned unsent arguments without quarantine', async t => {
  const { bridge, directory } = await fixture(t);
  const socket = await connect(t, bridge);
  const originalOpen = fs.open;
  try {
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (...values) => {
        await write(...values);
        const closed = once(socket, 'close');
        socket.close();
        await closed;
        await delay(5);
      };
      return handle;
    };
    assert.equal((await bridge.call('comp_list')).error.code, 'AE_NOT_CONNECTED');
    assert.equal(bridge.status().quarantined, false);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { fs.open = originalOpen; }
});

test('timeout quarantines queued work, ignores late reply, persists restart guard', async t => {
  const { bridge, directory } = await fixture(t, { timeoutMs: 80 });
  const socket = await connect(t, bridge);
  const jobs = [];
  socket.on('message', raw => jobs.push(JSON.parse(String(raw))));
  const first = bridge.call('comp_list');
  const queued = bridge.call('comp_list');
  assert.equal((await first).error.code, 'NATIVE_TIMEOUT');
  assert.equal((await queued).error.code, 'BRIDGE_QUARANTINED');
  assert.equal(jobs.length, 1);
  await fs.writeFile(jobs[0].resultPath, JSON.stringify({ ok: true, comps: [] }));
  socket.send(JSON.stringify({ id: jobs[0].id, ok: true }));
  await delay(20);
  assert.equal(bridge.status().quarantined, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'quarantine.json'), 'utf8')).id, jobs[0].id);
  await bridge.close();
  const restarted = await createAeBridge({ port: 0, token, jobDirectory: directory });
  t.after(() => restarted.close());
  assert.equal(restarted.status().quarantined, true);
  assert.equal((await restarted.call('comp_list')).error.code, 'BRIDGE_QUARANTINED');
});

test('missing result and disconnect during work remain unknown, not replayed', async t => {
  for (const mode of ['missing', 'disconnect']) {
    const { bridge } = await fixture(t);
    const socket = await connect(t, bridge);
    socket.on('message', raw => {
      const job = JSON.parse(String(raw));
      if (mode === 'missing') socket.send(JSON.stringify({ id: job.id, ok: true }));
      else socket.close();
    });
    const result = await bridge.call('comp_list');
    assert.equal(result.ok, false);
    assert.equal(bridge.status().quarantined, true);
    assert.equal((await bridge.call('comp_list')).error.code, 'BRIDGE_QUARANTINED');
  }
});

test('close resolves native/queued calls and releases listening port', async t => {
  const { bridge } = await fixture(t);
  const socket = await connect(t, bridge);
  const incoming = once(socket, 'message');
  const native = bridge.call('comp_list');
  const queued = bridge.call('comp_list');
  await incoming;
  const closed = once(socket, 'close');
  await bridge.close();
  await closed;
  assert.equal((await native).error.code, 'BRIDGE_CLOSED_UNKNOWN');
  assert.equal((await queued).error.code, 'BRIDGE_CLOSED');
  assert.equal(bridge.status().pending, null);
  assert.equal(bridge.status().waiting, 0);
  assert.equal(socket.readyState, WebSocket.CLOSED);
  await bridge.close();
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(bridge.status().port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});

test('unfinished job evidence from a previous process blocks fresh native work', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-ae-interrupted-'));
  await fs.writeFile(path.join(directory, 'previous.args.json'), '{}');
  const bridge = await createAeBridge({ port: 0, token, jobDirectory: directory });
  t.after(async () => { await bridge.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(bridge.status().quarantined, true);
  assert.equal((await bridge.call('comp_list')).error.code, 'BRIDGE_QUARANTINED');
});
