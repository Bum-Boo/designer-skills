import { prepareFiles, validateManifest, decodeManifest, compare, MAX_MANIFEST_BYTES } from './core.mjs';

const $ = id => document.getElementById(id);
const number = n => new Intl.NumberFormat('ko-KR').format(n);
const size = n => {
  if (n === undefined) return '—';
  if (n < 1024) return `${number(n)} B`;
  const power = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(n / 1024 ** power)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][power]}`;
};
const names = { reference: '기준', received: '받은 폴더' };
const labels = { missing: '없음', extra: '추가', changed: '변경', same: '같음' };
const state = { reference: null, received: null, referenceSource: 'folder', result: null,
  active: null, generation: 0, error: '', messages: {}, filter: 'all', page: 0, zeroConfirmed: false };
let worker = null, workerURL = null;
const PAGE_SIZE = 50;

function stop() {
  state.generation++;
  worker?.terminate(); worker = null;
  if (workerURL) URL.revokeObjectURL(workerURL);
  workerURL = null;
  state.active = null;
}

function clearVerdict() {
  state.result = null;
  state.zeroConfirmed = false;
  $('confirm-zero').checked = false;
  state.page = 0;
}

function begin(side, phase) {
  stop();
  state[side] = null;
  state.messages[side] = '';
  state.error = '';
  clearVerdict();
  state.active = { side, phase, runId: state.generation, done: 0, total: 0 };
  render();
  $('announcer').textContent = `${names[side]} 확인을 시작합니다.`;
  return state.generation;
}

function fail(runId, message) {
  if (runId !== state.generation) return;
  const side = state.active?.side;
  stop(); clearVerdict();
  if (side) state.messages[side] = '확인 실패';
  state.error = `비교를 끝내지 못했습니다. ${message} 복사·동기화를 끝내고 다시 선택하세요.`;
  render();
}

function complete(runId, manifest) {
  if (runId !== state.generation || !state.active) return;
  const side = state.active.side;
  try { state[side] = validateManifest(manifest); }
  catch (error) { fail(runId, error.message); return; }
  stop();
  if (state.reference && state.received) {
    if (!state.reference.file_count || !state.received.file_count) {
      state.error = '비어 있는 파일 목록으로는 비교를 완료할 수 없습니다. 파일이 있는 폴더를 선택하세요.';
    } else {
      state.result = compare(state.reference, state.received);
      state.filter = state.result.comparison.match ? 'all' : 'different';
    }
  }
  render();
  $('announcer').textContent = state.result ? $('verdict').textContent + ' ' + $('counts').textContent : `${names[side]} 확인을 마쳤습니다.`;
  if (state.result) $('verdict').focus();
}

async function pick(side, files) {
  const runId = begin(side, 'hash');
  try {
    const prepared = prepareFiles(files);
    state.active.total = prepared.total;
    if (side === 'reference') state.referenceSource = 'folder';
    workerURL = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(workerURL);
    worker.onmessage = ({ data }) => {
      if (data.runId !== state.generation || !state.active) return;
      if (data.type === 'progress') {
        Object.assign(state.active, { done: data.done, total: data.total });
        renderProgress();
      } else if (data.type === 'done') complete(runId, data.manifest);
      else if (data.type === 'error') fail(runId, data.message);
    };
    worker.onerror = event => { event.preventDefault(); fail(runId, '파일을 읽는 도중 오류가 났습니다.'); };
    worker.onmessageerror = () => fail(runId, '파일 데이터를 전달하지 못했습니다.');
    worker.postMessage({ runId, ...prepared });
    render();
  } catch (error) { fail(runId, error.message); }
}

async function importManifest(file) {
  const runId = begin('reference', 'import');
  state.referenceSource = 'manifest';
  try {
    if (file.size > MAX_MANIFEST_BYTES) throw new Error('목록 파일은 32 MiB까지 불러옵니다.');
    const buffer = await file.arrayBuffer();
    if (runId !== state.generation) return;
    complete(runId, decodeManifest(buffer));
  } catch (error) { fail(runId, error.message); }
}

function renderProgress() {
  const active = state.active;
  if (!active) return;
  const percent = active.total ? Math.min(100, Math.floor(100 * active.done / active.total)) : 0;
  $('progress').value = percent;
  $('progress-label').textContent = active.phase === 'import' ? '기준 목록을 읽는 중…' : `${names[active.side]} 확인 중 ${percent}% · ${size(active.done)} / ${size(active.total)}`;
}

function zeroCount() {
  if (!state.result) return 0;
  return state.result.rows.filter(row => row.reference?.bytes === 0 || row.received?.bytes === 0).length;
}

function render() {
  const busy = Boolean(state.active);
  for (const id of ['pick-reference', 'import-reference', 'pick-received']) $(id).disabled = busy;
  for (const side of ['reference', 'received']) {
    const m = state[side];
    $(side + '-summary').textContent = m ? `${m.target} · ${number(m.file_count)}개 파일 · ${size(m.total_bytes)}` : state.messages[side] ||
      (side === 'reference' ? '원본 폴더나 저장한 파일 목록(JSON)을 고르세요.' : '다른 기기로 옮겼거나 전달받은 폴더를 고르세요.');
  }
  $('work').hidden = !busy;
  renderProgress();
  $('error').hidden = !state.error;
  $('error').textContent = state.error;
  const result = state.result, zeros = zeroCount();
  const needsZeroCheck = Boolean(result?.comparison.match && zeros && !state.zeroConfirmed);
  $('verdict').textContent = result ? needsZeroCheck ? '0바이트 파일 확인 필요' : result.comparison.match ? '일치' : '차이 있음' : busy ? '파일 내용을 확인하고 있습니다…' : state.error ? '비교 미완료' : '두 쪽을 고르면 비교 결과가 나옵니다.';
  $('counts').textContent = result ? `없음 ${number(result.comparison.missing.length)} · 추가 ${number(result.comparison.extra.length)} · 변경 ${number(result.comparison.changed.length)} · 같음 ${number(result.rows.filter(r => r.status === 'same').length)}${zeros ? ` · 0바이트 파일 ${number(zeros)}개` : ''}` : '';
  $('zero-check').hidden = !result?.comparison.match || !zeros;
  $('zero-text').textContent = `0바이트 파일 ${number(zeros)}개가 원본에서도 비어 있음을 확인했습니다.`;
  for (const id of ['result-tools', 'table-wrap']) $(id).hidden = !result;
  $('save-reference').disabled = busy || !state.reference;
  $('save-received').disabled = busy || !state.received;
  $('save-report').disabled = busy || !result || needsZeroCheck;
  renderRows();
}

function renderRows() {
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  if (!state.result) { $('rows').replaceChildren(); $('pagination').hidden = true; return; }
  const query = $('search').value.normalize('NFC').toLocaleLowerCase('ko-KR');
  const rows = state.result.rows.filter(row => (state.filter === 'all' || state.filter === 'different' && row.status !== 'same' || row.status === state.filter) && row.path.normalize('NFC').toLocaleLowerCase('ko-KR').includes(query));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const fragment = document.createDocumentFragment();
  for (const row of rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)) {
    const tr = document.createElement('tr'); tr.dataset.status = row.status;
    const status = document.createElement('td'); status.textContent = labels[row.status]; tr.append(status);
    const path = document.createElement('td'); path.className = 'path'; path.textContent = row.path;
    if (row.note) { const note = document.createElement('span'); note.className = 'note'; note.textContent = row.note; path.append(note); }
    tr.append(path);
    for (const e of [row.reference, row.received]) { const cell = document.createElement('td'); cell.textContent = size(e?.bytes); tr.append(cell); }
    fragment.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 4; td.textContent = '조건에 맞는 파일이 없습니다.'; tr.append(td); fragment.append(tr); }
  $('rows').replaceChildren(fragment);
  $('visible-count').textContent = `${number(rows.length)}개 파일`;
  $('pagination').hidden = pages <= 1;
  $('previous').disabled = state.page === 0;
  $('next').disabled = state.page === pages - 1;
  $('page-label').textContent = `${number(state.page + 1)} / ${number(pages)}쪽`;
}

function save(manifest, suffix, extra = {}) {
  const value = { ...manifest, generator: { name: '파일 비교', version: '0.1.0' }, ...extra };
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${manifest.target.replace(/[^\p{L}\p{N}._-]+/gu, '_')}-${suffix}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

for (const side of ['reference', 'received']) {
  $('pick-' + side).onclick = () => { const input = $(side + '-files'); input.value = ''; input.click(); };
  $(side + '-files').onchange = event => { if (event.target.files.length) pick(side, event.target.files); };
}
$('import-reference').onclick = () => { $('manifest-file').value = ''; $('manifest-file').click(); };
$('manifest-file').onchange = event => { if (event.target.files[0]) importManifest(event.target.files[0]); };
$('cancel').onclick = () => {
  const side = state.active?.side;
  stop(); clearVerdict();
  if (side) state.messages[side] = '취소했습니다. 다시 고르면 처음부터 확인합니다.';
  render(); $('announcer').textContent = '확인을 취소했습니다.';
  if (side) $('pick-' + side).focus();
};
$('reset').onclick = () => { stop(); clearVerdict(); state.reference = null; state.received = null; state.error = ''; state.messages = {}; $('search').value = ''; render(); $('pick-reference').focus(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.active) $('cancel').click(); });
$('confirm-zero').onchange = event => { state.zeroConfirmed = event.target.checked; render(); };
document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => { state.filter = button.dataset.filter; state.page = 0; renderRows(); $('announcer').textContent = $('visible-count').textContent + ' 표시'; }; });
$('search').oninput = () => { state.page = 0; renderRows(); };
$('previous').onclick = () => { state.page--; renderRows(); };
$('next').onclick = () => { state.page++; renderRows(); };
$('save-reference').onclick = () => { if (!$('save-reference').disabled) save(state.reference, 'manifest'); };
$('save-received').onclick = () => { if (!$('save-received').disabled) save(state.received, 'manifest'); };
$('save-report').onclick = () => {
  if ($('save-report').disabled) return;
  save(state.received, 'compare', { comparison: state.result.comparison,
    reference: { source: state.referenceSource, target: state.reference.target, file_count: state.reference.file_count, total_bytes: state.reference.total_bytes },
    zero_byte_confirmation: Boolean(zeroCount() && state.zeroConfirmed), compared_at: new Date().toISOString() });
};
if (!('webkitdirectory' in document.createElement('input')) || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
  state.error = '이 브라우저는 폴더 선택 또는 파일 검사를 지원하지 않습니다. 최신 데스크톱 브라우저에서 여세요.';
  render();
  for (const id of ['pick-reference', 'pick-received', 'import-reference']) $(id).disabled = true;
} else render();
