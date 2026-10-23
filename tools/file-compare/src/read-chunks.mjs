export const CHUNK_BYTES = 1024 * 1024;

// WebKit file:// workers cannot read picked File handles. Read on the page.
// The hashing worker acknowledges each buffer before the next one is read.
export async function* fileChunks(file) {
  if (file.size === 0) {
    // slice(0, 0) does not open the backing file and can hide NotReadableError.
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength !== 0) throw new Error('파일 크기가 바뀌었습니다.');
    yield buffer;
    return;
  }
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const expected = Math.min(CHUNK_BYTES, file.size - offset);
    const buffer = await file.slice(offset, offset + expected).arrayBuffer();
    if (buffer.byteLength !== expected) throw new Error('파일을 끝까지 읽지 못했습니다.');
    yield buffer;
  }
}
