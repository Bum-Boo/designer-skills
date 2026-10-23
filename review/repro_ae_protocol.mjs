// Synthetic review harness (2026-10-23) for mcp/ae/bridge.mjs. Mock CEP sockets only:
// no After Effects, no CEP panel, no native ExtendScript. Run from the repository root:
//   node review/repro_ae_protocol.mjs
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createAeBridge} from '../mcp/ae/bridge.mjs';

const token = 'synthetic-review-token-'.repeat(2);
const record = (id, observed, expectation) => console.log(JSON.stringify({id, observed, expectation}));
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-review-ae-'));

async function panel(bridge, supplied = token) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.status().port}/ae`, {maxPayload: 1 << 20});
  socket.on('error', () => {});
  await once(socket, 'open');
  const first = Promise.race([once(socket, 'message').then(([m]) => String(m)), once(socket, 'close').then(([c]) => 'close ' + c)]);
  socket.send(JSON.stringify({token: supplied}));
  return {socket, first: await first};
}
async function fresh(name, options = {}) {
  const jobDirectory = path.join(base, name);
  return createAeBridge({port: 0, token, jobDirectory, timeoutMs: 500, ...options});
}

try {
  {
    const bridge = await fresh('no-panel');
    const r = await bridge.call('ae_status', {});
    record('ae_status-without-panel', {ok: r.ok, native: r.native, connected: r.bridge.connected},
      'Bridge-only status: ok=true, so MCP isError=false although AE is not connected');
    const c = await bridge.call('comp_list', {});
    record('comp_list-without-panel', c, 'AE_NOT_CONNECTED failure');
    await bridge.close();
  }
  {
    const bridge = await fresh('handshake');
    const a = await panel(bridge);
    const b = await panel(bridge);
    const wrong = await panel(bridge, 'x'.repeat(token.length));
    record('handshake', {first: a.first, second: b.first, wrongToken: wrong.first}, 'connected / 4009 / 4003');
    // Status result content is not shape-checked beyond ok:boolean.
    a.socket.on('message', async raw => {
      const job = JSON.parse(String(raw));
      await fs.writeFile(job.resultPath, JSON.stringify({ok: true}));
      a.socket.send(JSON.stringify({id: job.id, ok: true}));
    });
    const s = await bridge.call('ae_status', {});
    record('status-minimal-native-result', {ok: s.ok, version: s.version ?? null, project: s.project ?? null},
      'Accepted: a bare {ok:true} file is reported as a successful native status');
    a.socket.terminate();
    await bridge.close();
  }
  for (const [label, misbehave] of [
    ['non-json-during-work', s => s.send('not json')],
    ['oversized-frame-during-work', s => s.send('x'.repeat(70000))],
    ['wrong-id-then-silence', (s, job) => s.send(JSON.stringify({id: job.id + 'x', ok: true}))],
    ['ok-true-without-result-file', (s, job) => s.send(JSON.stringify({id: job.id, ok: true}))],
    ['result-file-not-object', async (s, job) => { await fs.writeFile(job.resultPath, '[]'); s.send(JSON.stringify({id: job.id, ok: true})); }],
  ]) {
    const bridge = await fresh(label);
    const p = await panel(bridge);
    p.socket.on('message', raw => misbehave(p.socket, JSON.parse(String(raw))));
    const r = await bridge.call('comp_list', {});
    const after = await bridge.call('comp_list', {});
    const files = (await fs.readdir(path.join(base, label))).sort();
    record('protocol:' + label, {first: r.error?.code ?? r, next: after.error?.code ?? after, quarantined: bridge.status().quarantined,
      quarantineReceipt: files.includes('quarantine.json')}, 'Unknown outcome -> quarantine; never success');
    p.socket.terminate();
    await bridge.close();
  }
  {
    // A native script error is a reported failure, not a quarantine; the mock cannot show AE side effects.
    const bridge = await fresh('jsx-error', {allowScripts: true});
    const p = await panel(bridge);
    p.socket.on('message', async raw => {
      const job = JSON.parse(String(raw));
      await fs.writeFile(job.resultPath, JSON.stringify({ok: false, error: {code: 'JSX_ERROR', message: 'thrown after partial edits'}}));
      p.socket.send(JSON.stringify({id: job.id, ok: true}));
    });
    const r = await bridge.call('run_jsx', {code: 'app.project.items.addFolder("x"); throw new Error("y");'});
    record('run_jsx-native-error', {ok: r.ok, code: r.error?.code, quarantined: bridge.status().quarantined},
      'Failure is returned; host endUndoGroup in finally does not roll back edits made before the throw (static)');
    p.socket.terminate();
    await bridge.close();
  }
  {
    // Existing job directory permissions are not tightened or checked.
    const dir = path.join(base, 'existing-open');
    await fs.mkdir(dir, {mode: 0o777});
    await fs.chmod(dir, 0o777);
    const bridge = await createAeBridge({port: 0, token, jobDirectory: dir});
    record('existing-job-directory-mode', {mode: ((await fs.stat(dir)).mode & 0o777).toString(8)},
      'Accepted as-is; 0o700 applies only when the bridge creates the directory');
    await bridge.close();
  }
} finally {
  await fs.rm(base, {recursive: true, force: true});
}
