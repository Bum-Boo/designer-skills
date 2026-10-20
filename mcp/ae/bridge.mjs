import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const failure = (code, message) => ({ ok: false, error: { code, message } });
const object = value => value && typeof value === 'object' && !Array.isArray(value);

/** Narrow local AE connection. No process spawning, hub discovery, or credential persistence. */
export async function createAeBridge({ port = 47620, token, jobDirectory, allowScripts = false, timeoutMs = 30000 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Token must have at least 32 characters');
  if (typeof jobDirectory !== 'string' || !path.isAbsolute(jobDirectory)) throw new Error('Absolute jobDirectory required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid timeoutMs');
  await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(jobDirectory)).isSymbolicLink()) throw new Error('Job directory must not be a symlink');
  const quarantinePath = path.join(jobDirectory, 'quarantine.json');
  const names = await fs.readdir(jobDirectory);
  // A previous process may have died before it could write a quarantine receipt.
  let quarantined = names.includes('quarantine.json') || names.some(name =>
    name.endsWith('.args.json') && !names.includes(name.replace(/\.args\.json$/, '.result.json')));
  let closed = false;
  let closing = null;
  let panel = null;
  let pending = null;
  let tail = Promise.resolve();
  let waiting = 0;
  const sockets = new Set();
  const authTimers = new Map();
  const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/ae', maxPayload: 65536 });
  await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  wss.on('error', () => {});
  const boundPort = wss.address().port;
  const status = () => ({ port: boundPort, host: '127.0.0.1', connected: panel?.readyState === WebSocket.OPEN,
    closed, quarantined, pending: pending?.id || null, waiting, scriptsEnabled: allowScripts === true });

  async function markUnknown(entry, code, message) {
    quarantined = true;
    try {
      await fs.writeFile(quarantinePath, JSON.stringify({ schema: 1, id: entry.id, call: entry.call,
        reason: code, argsPath: entry.argsPath, resultPath: entry.resultPath,
        message: 'Native execution may still complete. Inspect AE and evidence before manual recovery.' }, null, 2), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') message += '; quarantine receipt could not be written';
    }
    return failure(code, message);
  }

  async function settle(entry, result, unknown = false) {
    if (pending !== entry || entry.settling) return;
    entry.settling = true;
    clearTimeout(entry.timer);
    if (unknown) result = await markUnknown(entry, result.error.code, result.error.message);
    pending = null;
    entry.resolve(result);
  }

  wss.on('connection', socket => {
    sockets.add(socket);
    let authenticated = false;
    const timer = setTimeout(() => socket.terminate(), Math.min(timeoutMs, 5000));
    authTimers.set(socket, timer);
    socket.on('error', () => {});
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { socket.close(4001, 'Invalid message'); return; }
      if (!authenticated) {
        const supplied = typeof message?.token === 'string' ? Buffer.from(message.token) : Buffer.alloc(0);
        const expected = Buffer.from(token);
        if (closed || !object(message) || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          socket.close(4003, 'Unauthorized'); return;
        }
        if (panel && panel.readyState === WebSocket.OPEN) { socket.close(4009, 'Panel already connected'); return; }
        authenticated = true;
        clearTimeout(timer);
        authTimers.delete(socket);
        panel = socket;
        socket.send(JSON.stringify({ type: 'connected' }));
        return;
      }
      const entry = pending;
      if (!entry || entry.socket !== socket || message?.id !== entry.id || entry.settling) return;
      if (message.ok !== true) {
        await settle(entry, failure('NATIVE_RESULT_UNKNOWN', 'CEP dispatch failed; inspect AE before recovery'), true);
        return;
      }
      try {
        const metadata = await fs.lstat(entry.resultPath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) throw new Error('Invalid result file');
        const result = JSON.parse((await fs.readFile(entry.resultPath, 'utf8')).replace(/^\uFEFF/, ''));
        if (!object(result) || typeof result.ok !== 'boolean') throw new Error('Invalid native result');
        if (result.ok && entry.call === 'list_comps' && !Array.isArray(result.comps)) throw new Error('Missing comp list');
        await settle(entry, result);
      } catch {
        await settle(entry, failure('NATIVE_RESULT_UNKNOWN', 'Native result missing or invalid; inspect AE before recovery'), true);
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      authTimers.delete(socket);
      sockets.delete(socket);
      if (panel === socket) panel = null;
      if (pending?.socket === socket) void settle(pending, failure('NATIVE_DISCONNECTED', 'Panel disconnected during native work'), true);
    });
  });

  async function dispatch(method, args) {
    if (closed) return failure('BRIDGE_CLOSED', 'Bridge is closed');
    if (quarantined) return failure('BRIDGE_QUARANTINED', 'Inspect prior native work and quarantine receipt before manual recovery');
    if (!panel || panel.readyState !== WebSocket.OPEN) return failure('AE_NOT_CONNECTED', 'Open and connect the CEP panel');
    const call = { ae_status: 'status', comp_list: 'list_comps', run_jsx: 'run_jsx' }[method];
    const id = randomUUID();
    const argsPath = path.join(jobDirectory, id + '.args.json');
    const resultPath = path.join(jobDirectory, id + '.result.json');
    const payload = method === 'run_jsx' ? { code: args.code, args: args.args || {}, undoLabel: args.undoLabel || 'Designer skills' } : {};
    let handle;
    try {
      handle = await fs.open(argsPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(payload).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
      await handle.close();
    } catch {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.rm(argsPath, { force: true }).catch(() => {});
      }
      return failure('JOB_WRITE_FAILED', 'Could not create argument file');
    }
    // Recheck after filesystem work: close/disconnect may happen while writing.
    if (closed || !panel || panel.readyState !== WebSocket.OPEN) {
      await fs.rm(argsPath, { force: true }).catch(() => {});
      return failure('AE_NOT_CONNECTED', 'Panel unavailable before dispatch');
    }
    return new Promise(resolve => {
      const entry = { id, call, argsPath, resultPath, socket: panel, resolve, settling: false };
      entry.timer = setTimeout(() => void settle(entry, failure('NATIVE_TIMEOUT', 'Native call timed out; it may still execute'), true), timeoutMs);
      pending = entry;
      panel.send(JSON.stringify({ id, call, argsPath, resultPath }), error => {
        if (error) void settle(entry, failure('NATIVE_SEND_UNKNOWN', 'Native dispatch result is unknown'), true);
      });
    });
  }

  function call(method, args = {}) {
    if (!['ae_status', 'comp_list', 'run_jsx'].includes(method)) return Promise.resolve(failure('UNKNOWN_METHOD', 'Unsupported AE method'));
    if (!object(args)) return Promise.resolve(failure('BAD_ARGUMENTS', 'Arguments must be an object'));
    const keys = method === 'run_jsx' ? ['code', 'args', 'undoLabel'] : [];
    if (Object.keys(args).some(key => !keys.includes(key))) return Promise.resolve(failure('BAD_ARGUMENTS', 'Unexpected argument'));
    if (method === 'run_jsx') {
      if (allowScripts !== true) return Promise.resolve(failure('SCRIPTS_DISABLED', 'Native scripts require explicit opt-in'));
      if (typeof args.code !== 'string' || !args.code.trim() || args.code.length > 1000000 ||
          (args.args !== undefined && !object(args.args)) || (args.undoLabel !== undefined && typeof args.undoLabel !== 'string'))
        return Promise.resolve(failure('BAD_ARGUMENTS', 'Invalid script arguments'));
    }
    if (method === 'ae_status' && !panel) return Promise.resolve({ ok: true, bridge: status(), native: null });
    waiting++;
    const result = tail.then(async () => {
      waiting--;
      const native = await dispatch(method, args);
      return method === 'ae_status' && native.ok ? { ...native, bridge: status() } : native;
    });
    tail = result.catch(() => {});
    return result;
  }

  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      if (pending) await settle(pending, failure('BRIDGE_CLOSED_UNKNOWN', 'Bridge closed during native work'), true);
      for (const timer of authTimers.values()) clearTimeout(timer);
      authTimers.clear();
      for (const socket of sockets) socket.close(1001, 'Bridge closing');
      const force = setTimeout(() => { for (const socket of sockets) socket.terminate(); }, 100);
      await new Promise(resolve => wss.close(resolve));
      clearTimeout(force);
      await tail;
    })();
    return closing;
  }
  return { status, call, close };
}
