import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Runtime} from './runtime.mjs';

test('workspace boundary rejects traversal and an existing symlink ancestor', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-boundary-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const workspace = path.join(dir, 'workspace'), outside = path.join(dir, 'outside');
  await mkdir(workspace); await mkdir(outside);
  const rt = await Runtime.create(workspace);
  t.after(() => rt.close());
  await assert.rejects(rt.scoped('../outside'), /escapes/);
  await assert.rejects(rt.scoped(path.join(outside, 'new', 'file')), /escapes/);
  assert.equal(await rt.scoped('new/file'), path.join(workspace, 'new/file'));
  try { await symlink(outside, path.join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.diagnostic('Symlink creation requires local privilege'); throw error; }
  await assert.rejects(rt.scoped('link/new/file'), /escapes/);
});

test('subprocess exit, missing executable, timeout, output cap and cleanup', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-process-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const rt = await Runtime.create(dir);
  t.after(() => rt.close());
  assert.equal((await rt.run(process.execPath, ['-e', 'console.log("ok")'])).stdout.trim(), 'ok');
  await assert.rejects(rt.run('designer-no-such-executable', []), /ENOENT/);
  await assert.rejects(rt.run(process.execPath, ['-e', 'process.exit(2)']), /exited 2/);
  await assert.rejects(rt.run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {timeout: 60}), /timed out/);
  await assert.rejects(rt.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(5*1024*1024))']), /exceeded/);
  assert.equal(rt.children.size, 0);
  rt.close();
  await assert.rejects(rt.run(process.execPath, ['-e', '']), /closed/);
});

test('real Python helper inventory, mismatch comparison and artifact verification', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-helpers-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const name of ['reference', 'delivery']) await mkdir(path.join(dir, name));
  await writeFile(path.join(dir, 'reference/file.txt'), 'original');
  await writeFile(path.join(dir, 'delivery/file.txt'), 'changed');
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Fixture</title>');
  const rt = await Runtime.create(dir, {python: process.env.PYTHON || 'python'});
  t.after(() => rt.close());
  const inventory = await rt.inventory('reference');
  assert.equal(inventory.file_count, 1);
  assert.match(inventory.entries[0].sha256, /^[a-f0-9]{64}$/);
  const compared = await rt.compare('reference', 'delivery');
  assert.deepEqual(compared.comparison.changed, ['file.txt']);
  assert.equal(compared.comparison.match, false);
  const verified = await rt.verify({root: '.'});
  assert.equal(verified.status, 'PASS');
  await assert.rejects(rt.verify({root: '.', entry: '../escape.html'}), /escapes/);
});
