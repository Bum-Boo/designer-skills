import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileChunks, CHUNK_BYTES } from '../src/read-chunks.mjs';
import { visibleText } from '../src/core.mjs';

test('reads bounded slices and probes the original zero-byte File for read errors', async () => {
  const original = new Uint8Array(CHUNK_BYTES * 2 + 17).map((_, i) => i % 251);
  const file = new File([original], 'video.bin');
  const sizes = [], hash = createHash('sha256');
  // The positive-size path must never read the entire File.
  file.arrayBuffer = () => { throw new Error('whole file read'); };
  for await (const buffer of fileChunks(file)) { sizes.push(buffer.byteLength); hash.update(new Uint8Array(buffer)); }
  assert.deepEqual(sizes, [CHUNK_BYTES, CHUNK_BYTES, 17]);
  assert.equal(hash.digest('hex'), createHash('sha256').update(original).digest('hex'));
  const empty = new File([], 'empty.txt');
  const emptyChunks = [];
  for await (const buffer of fileChunks(empty)) emptyChunks.push(buffer);
  assert.equal(emptyChunks[0].byteLength, 0);
  const unreadable = { size: 0, arrayBuffer: async () => { throw new Error('NotReadableError'); },
    slice: () => new Blob([]) };
  await assert.rejects(async () => { for await (const _ of fileChunks(unreadable)) { /* unreachable */ } }, /NotReadableError/);
  const truncated = { size: 5, slice: () => new Blob([new Uint8Array(4)]) };
  await assert.rejects(async () => { for await (const _ of fileChunks(truncated)) { /* unreachable */ } }, /끝까지/);
});

test('actual WASM worker consumes transferred chunks with exact byte counts and refuses partial jobs', async () => {
  const source = new URL('../src/worker.mjs', import.meta.url).href;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    globalThis.self={postMessage:data=>parentPort.postMessage(data)};
    await import(${JSON.stringify(source)});
    parentPort.on('message',data=>self.onmessage({data}));
  `)));
  let id = 0;
  const rpc = (type, data = {}, transfer = [], runId = 9) => new Promise((resolve, reject) => {
    const onMessage = result => {
      worker.off('error', onError);
      if (result.type === 'error') reject(new Error(result.message)); else resolve(result.result);
    };
    const onError = error => { worker.off('message', onMessage); reject(error); };
    worker.once('message', onMessage); worker.once('error', onError);
    worker.postMessage({ type, runId, id: ++id, ...data }, transfer);
  });
  try {
    await rpc('start', { target: 'delivery', fileCount: 1 });
    const bytes = new Uint8Array(CHUNK_BYTES + 37).map((_, i) => i % 199);
    await rpc('file', { path: 'render/영상.bin', bytes: bytes.length });
    const first = bytes.slice(0, CHUNK_BYTES).buffer;
    await rpc('chunk', { buffer: first }, [first]); assert.equal(first.byteLength, 0);
    await assert.rejects(rpc('file-end'), /끝까지/);
    await assert.rejects(rpc('finish'), /끝나지/);
    const last = bytes.slice(CHUNK_BYTES).buffer;
    await rpc('chunk', { buffer: last }, [last]); await rpc('file-end');
    const manifest = await rpc('finish');
    assert.equal(manifest.entries[0].sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(manifest.total_bytes, bytes.length);
    await assert.rejects(rpc('finish', {}, [], 10), /세션/);
    await rpc('start', { target: 'bad', fileCount: 1 });
    await rpc('file', { path: 'x', bytes: CHUNK_BYTES + 1 });
    await assert.rejects(rpc('chunk', { buffer: new ArrayBuffer(CHUNK_BYTES + 1) }), /조각/);
  } finally { await worker.terminate(); }
});

test('invisible filename controls are visible without changing stored path identity', () => {
  assert.equal(visibleText('"q" & \u202Etxt.exe'), '"q" & ⟨U+202E⟩txt.exe');
  assert.equal(visibleText('보고서\u200B.txt'), '보고서⟨U+200B⟩.txt');
  assert.equal(visibleText('render/보고서.txt'), 'render/보고서.txt');
});
