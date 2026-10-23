import { createSHA256 } from 'hash-wasm';
import { createManifest } from './core.mjs';
import { CHUNK_BYTES } from './read-chunks.mjs';

let hash, target, activeRun, file = null, entries = [], expectedCount;
self.onmessage = async ({ data }) => {
  const { runId, id, type } = data;
  try {
    let result;
    if (type === 'start') {
      hash = await createSHA256();
      activeRun = runId; target = data.target; expectedCount = data.fileCount;
      entries = []; file = null;
    } else {
      if (!hash || activeRun !== runId) throw new Error('파일 확인 세션이 다릅니다.');
      if (type === 'file') {
        if (file) throw new Error('이전 파일 확인이 끝나지 않았습니다.');
        hash.init(); file = { path: data.path, bytes: data.bytes, read: 0 };
      } else if (type === 'chunk') {
        if (!file || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength > CHUNK_BYTES ||
            file.read + data.buffer.byteLength > file.bytes) throw new Error('파일 조각의 크기가 다릅니다.');
        hash.update(new Uint8Array(data.buffer)); file.read += data.buffer.byteLength;
      } else if (type === 'file-end') {
        if (!file || file.read !== file.bytes) throw new Error('파일을 끝까지 읽지 못했습니다.');
        entries.push({ path: file.path, bytes: file.read, sha256: hash.digest('hex') }); file = null;
      } else if (type === 'finish') {
        if (file || entries.length !== expectedCount) throw new Error('파일 확인이 끝나지 않았습니다.');
        result = createManifest(target, entries);
      } else throw new Error('알 수 없는 파일 확인 요청입니다.');
    }
    self.postMessage({ runId, id, type: 'result', result });
  } catch (error) { self.postMessage({ runId, id, type: 'error', message: error.message }); }
};
