import { createSHA256 } from 'hash-wasm';
import { createManifest } from './core.mjs';

const CHUNK = 1024 * 1024;
self.onmessage = async ({ data: { runId, target, total, items } }) => {
  let done = 0, lastUpdate = 0, path = '';
  try {
    const hash = await createSHA256();
    const entries = [];
    for (const item of items) {
      path = item.path;
      const file = item.file;
      hash.init();
      let read = 0;
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const expected = Math.min(CHUNK, file.size - offset);
        const chunk = new Uint8Array(await file.slice(offset, offset + expected).arrayBuffer());
        if (chunk.length !== expected) throw new Error('파일을 끝까지 읽지 못했습니다.');
        hash.update(chunk);
        read += chunk.length;
        done += chunk.length;
        if (Date.now() - lastUpdate > 250) {
          self.postMessage({ type: 'progress', runId, done, total, path });
          lastUpdate = Date.now();
        }
      }
      if (read !== file.size) throw new Error('파일 크기가 바뀌었습니다.');
      entries.push({ path, bytes: read, sha256: hash.digest('hex') });
    }
    self.postMessage({ type: 'done', runId, manifest: createManifest(target, entries) });
  } catch (error) {
    self.postMessage({ type: 'error', runId, message: `${path ? path + ': ' : ''}${error.message}` });
  }
};
