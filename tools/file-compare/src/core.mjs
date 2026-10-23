import folding from '../vendor/casefold.json' with { type: 'json' };

export const MAX_ENTRIES = 200_000;
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const own = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
export const codePointOrder = (a, b) => {
  const x = Array.from(a, c => c.codePointAt(0));
  const y = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
};

export function canonical(path) {
  if (typeof path !== 'string' || !path || path.length > 4096 ||
      /[\\:\u0000-\u001f]/u.test(path) || path.startsWith('/') ||
      path.split('/').some(p => !p || p === '.' || p === '..') ||
      /[\uD800-\uDFFF]/u.test(path)) {
    throw new Error('안전하지 않거나 너무 긴 경로입니다.');
  }
  // Full Unicode 16 case folding, matching Python's NFC(...).casefold().
  return Array.from(path.normalize('NFC'), c => folding[c] ?? c).join('');
}

function entriesChecked(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) {
    throw new Error('파일 목록 형식이 다르거나 200,000개를 넘습니다.');
  }
  const seen = new Set();
  let total = 0;
  const rows = entries.map((e, i) => {
    try {
      if (!own(e)) throw new Error('파일 항목 형식이 다릅니다.');
      const key = canonical(e.path);
      if (seen.has(key)) throw new Error('대소문자 또는 이름 표기가 겹칩니다.');
      seen.add(key);
      if (!integer(e.bytes)) throw new Error('파일 크기는 0 이상의 정수여야 합니다.');
      if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
        throw new Error('SHA-256 값의 형식이 다릅니다.');
      }
      total += e.bytes;
      if (!integer(total)) throw new Error('크기 합계가 지원 범위를 넘습니다.');
      return { path: e.path, bytes: e.bytes, sha256: e.sha256 };
    } catch (error) { throw new Error(`${i + 1}번째 항목: ${error.message}`); }
  });
  rows.sort((a, b) => codePointOrder(a.path, b.path));
  return { rows, total };
}

export function safeLabel(value, fallback = '폴더') {
  return typeof value === 'string' ? value.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 200) || fallback : fallback;
}

export function validateManifest(value) {
  if (!own(value) || value.schema_version !== 1) {
    throw new Error('schema_version이 1인 파일 목록(JSON)이 필요합니다.');
  }
  const { rows, total } = entriesChecked(value.entries);
  if (!integer(value.file_count) || value.file_count !== rows.length ||
      !integer(value.total_bytes) || value.total_bytes !== total) {
    throw new Error('파일 수 또는 크기 합계가 맞지 않습니다.');
  }
  return { schema_version: 1, target: safeLabel(value.target, '불러온 목록'), kind: 'folder',
    file_count: rows.length, total_bytes: total, entries: rows };
}

export function createManifest(target, entries) {
  const { rows, total } = entriesChecked(entries);
  return { schema_version: 1, target: safeLabel(target), kind: 'folder',
    file_count: rows.length, total_bytes: total, entries: rows };
}

export function prepareFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) throw new Error('읽을 파일이 없습니다. 빈 폴더는 비교할 수 없습니다.');
  if (files.length > MAX_ENTRIES) throw new Error('파일은 200,000개까지 비교합니다.');
  const seen = new Set();
  let root = null, total = 0;
  const items = files.map(file => {
    const relative = file.webkitRelativePath;
    if (typeof relative !== 'string' || relative.indexOf('/') < 1) {
      throw new Error('폴더 경로를 읽지 못했습니다. 데스크톱의 폴더 선택을 사용하세요.');
    }
    const slash = relative.indexOf('/');
    const folder = relative.slice(0, slash), path = relative.slice(slash + 1);
    root ??= folder;
    if (root !== folder) throw new Error('한 번에 한 폴더를 선택하세요.');
    const key = canonical(path);
    if (seen.has(key)) throw new Error(`이름이 겹칩니다: ${path}`);
    seen.add(key);
    if (!integer(file.size)) throw new Error(`파일 크기를 읽지 못했습니다: ${path}`);
    total += file.size;
    if (!integer(total)) throw new Error('크기 합계가 지원 범위를 넘습니다.');
    return { file, path };
  });
  items.sort((a, b) => codePointOrder(a.path, b.path));
  return { target: root, total, items };
}

export function compare(reference, received) {
  const before = new Map(reference.entries.map(e => [e.path, e]));
  const after = new Map(received.entries.map(e => [e.path, e]));
  const missing = [], extra = [], changed = [], rows = [];
  const aliases = new Map();
  for (const e of received.entries) aliases.set(canonical(e.path), e.path);
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort(codePointOrder)) {
    const a = before.get(path), b = after.get(path);
    const status = !b ? 'missing' : !a ? 'extra' : a.bytes !== b.bytes || a.sha256 !== b.sha256 ? 'changed' : 'same';
    if (status === 'missing') missing.push(path);
    if (status === 'extra') extra.push(path);
    if (status === 'changed') changed.push(path);
    let note = '';
    if (!b && aliases.has(canonical(path))) {
      const other = aliases.get(canonical(path));
      note = path.normalize('NFC') === other.normalize('NFC') ? '이름 표기 방식만 다름' : '대소문자 등의 이름 표기가 다름';
    }
    rows.push({ path, status, reference: a, received: b, note });
  }
  return { comparison: { match: !(missing.length || extra.length || changed.length), missing, extra, changed }, rows };
}

export function decodeManifest(buffer) {
  if (buffer.byteLength > MAX_MANIFEST_BYTES) throw new Error('목록 파일은 32 MiB까지 불러옵니다.');
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4 && ((bytes[0] === 0 && bytes[1] === 0) || (bytes[0] === 255 && bytes[1] === 254 && bytes[2] === 0 && bytes[3] === 0))) {
    throw new Error('UTF-32 목록은 UTF-8로 저장한 뒤 불러오세요.');
  }
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  try { return validateManifest(JSON.parse(new TextDecoder(encoding, { fatal: true }).decode(buffer))); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('올바른 UTF-8 또는 BOM이 있는 UTF-16 JSON 파일이 필요합니다.');
    throw error;
  }
}
