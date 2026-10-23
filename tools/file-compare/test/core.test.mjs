import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createManifest, validateManifest, prepareFiles, compare, canonical, codePointOrder, decodeManifest } from '../src/core.mjs';

const hash = content => createHash('sha256').update(content).digest('hex');
const entry = (path, content = 'one') => ({ path, bytes: Buffer.byteLength(content), sha256: hash(content) });
const base = () => createManifest('delivery', [entry('art/보고서.txt'), entry('main.blend', 'project')]);

test('matches exact contents and detects same-size changes, missing and extra paths', () => {
  const before = base();
  assert.equal(compare(before, validateManifest(structuredClone(before))).comparison.match, true);
  const after = createManifest('copy', [entry('art/보고서.txt', 'two'), entry('new.mov', 'video')]);
  assert.deepEqual(compare(before, after).comparison, {
    match: false, missing: ['main.blend'], extra: ['new.mov'], changed: ['art/보고서.txt']
  });
});

test('normalization and case aliases never become identical paths', () => {
  for (const [a, b] of [['보고서.txt', '보고서.txt'.normalize('NFD')], ['main.AEP', 'main.aep'], ['Maße', 'MASSE']]) {
    const result = compare(createManifest('a', [entry(a)]), createManifest('b', [entry(b)]));
    assert.deepEqual(result.comparison.missing, [a]);
    assert.deepEqual(result.comparison.extra, [b]);
    assert.equal(result.comparison.match, false);
    assert.ok(result.rows.find(r => r.status === 'missing').note);
    assert.throws(() => createManifest('x', [entry(a), entry(b)]), /겹칩니다/);
  }
});

test('refuses malformed objects, unsafe paths, counts, hash and size types', () => {
  for (const bad of [null, [], true, 'x', {}, { ...base(), schema_version: true }]) assert.throws(() => validateManifest(bad));
  for (const path of ['', '/etc/file', '../x', 'a/../x', './x', 'a//b', 'C:x', 'a\\b', 'a\n.txt', '\uD800']) {
    assert.throws(() => createManifest('x', [entry(path)]));
  }
  for (const bytes of [-1, true, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.throws(() => validateManifest({ ...base(), entries: [{ ...entry('x'), bytes }] }));
  }
  for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), null]) {
    assert.throws(() => createManifest('x', [{ ...entry('x'), sha256 }]));
  }
  for (const patch of [{ file_count: 99 }, { total_bytes: 1 }, { entries: [null] }]) assert.throws(() => validateManifest({ ...base(), ...patch }));
  assert.throws(() => createManifest('x', [entry('same'), entry('same')]));
});

test('full case folding preserves dotless i distinction and Cherokee compatibility', () => {
  assert.notEqual(canonical('ı'), canonical('i'));
  assert.equal(canonical('Σ'), canonical('ς'));
  assert.equal(canonical('ß'), 'ss');
  assert.equal(canonical('ꭰ'), canonical('Ꭰ'));
  assert.ok(codePointOrder('\uE000', '😀') < 0);
  assert.doesNotThrow(() => createManifest('x', [entry('😀.txt'), entry('\uE000.txt')]));
});

test('folder picker strips exactly one common root and refuses ambiguous selections', () => {
  const file = (webkitRelativePath, size = 3) => ({ webkitRelativePath, size });
  const model = prepareFiles([file('delivery/nested/a.txt'), file('delivery/b.txt')]);
  assert.equal(model.target, 'delivery');
  assert.equal(model.total, 6);
  assert.deepEqual(model.items.map(f => f.path), ['b.txt', 'nested/a.txt']);
  for (const files of [[], [file('a')], [file('root/a'), file('other/b')], [file('root/A'), file('root/a')], [file('root/../x')], [file('root/x', NaN)]]) assert.throws(() => prepareFiles(files));
});

test('reads UTF-8 and BOM UTF-16; errors rather than silently accepting corrupt input', () => {
  const text = JSON.stringify(base());
  for (const bytes of [Buffer.from(text), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]), Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')])]) {
    assert.deepEqual(decodeManifest(bytes), base());
  }
  for (const bytes of [Buffer.from([255, 254, 0, 0]), Buffer.from(text, 'utf16le'), Buffer.from([0xff, 0x61]), Buffer.from('{}')]) assert.throws(() => decodeManifest(bytes));
});

test('browser and existing Python helper agree in both directions on synthetic delivery', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-interop-'));
  const fixture = join(root, 'fixture'); mkdirSync(join(fixture, 'render'), { recursive: true });
  const contents = [['render/보고서.txt', '연구 자료 예시'], ['project.blend', 'synthetic'], ['.DS_Store', 'synthetic metadata']];
  for (const [path, text] of contents) writeFileSync(join(fixture, path), text);
  const script = resolve('../../skills/asset-delivery/scripts/delivery_manifest.py');
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  try {
    const manifest = createManifest('fixture', contents.map(([path, text]) => entry(path, text)));
    const baseline = join(root, 'baseline.json'); writeFileSync(baseline, JSON.stringify(manifest));
    const run = spawnSync(python, [script, fixture, '--compare', baseline], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const cli = JSON.parse(run.stdout);
    assert.deepEqual(cli.entries, manifest.entries);
    assert.equal(compare(validateManifest(cli), manifest).comparison.match, true);
    writeFileSync(join(fixture, 'project.blend'), 'SYNTHETIC');
    rmSync(join(fixture, '.DS_Store')); writeFileSync(join(fixture, 'extra.mov'), 'new');
    const changedRun = spawnSync(python, [script, fixture, '--compare', baseline], { encoding: 'utf8' });
    assert.equal(changedRun.status, 1, changedRun.stderr);
    const changed = JSON.parse(changedRun.stdout);
    assert.deepEqual(compare(manifest, validateManifest(changed)).comparison, changed.comparison);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('vendored full case folding agrees with Python for every mapped code point', () => {
  const table = JSON.parse(readFileSync(new URL('../vendor/casefold.json', import.meta.url)));
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const run = spawnSync(python, ['-c', 'import sys,json; x=json.load(sys.stdin); print(json.dumps({c:c.casefold() for c in x},ensure_ascii=True))'], { input: JSON.stringify(Object.keys(table)), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  // Python 3.14 / Unicode 16 is the reference. Older Python versions may lack newer entries.
  const expected = JSON.parse(run.stdout);
  for (const [c, folded] of Object.entries(expected)) {
    if (folded !== c) assert.equal(table[c], folded, `U+${c.codePointAt(0).toString(16)}`);
  }
});
