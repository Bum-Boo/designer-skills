import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installPanel, extensionId } from './install-panel.mjs';

test('installer dry-run creates nothing; apply copies standalone panel and refuses overwrite', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-cep-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'extensions');
  const plan = await installPanel({ destination });
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.target, path.join(destination, extensionId));
  await assert.rejects(fs.access(destination));
  const result = await installPanel({ destination, apply: true });
  assert.equal(result.unsignedCepSettingsChanged, false);
  const manifest = await fs.readFile(path.join(result.target, 'CSXS', 'manifest.xml'), 'utf8');
  assert.match(manifest, /org\.bumboo\.designerskills\.ae/);
  const host = await fs.readFile(path.join(result.target, 'host', 'aebridge.jsx'));
  assert.ok(host.length > 10000);
  assert.match(await fs.readFile(path.join(result.target, 'client', 'connection.js'), 'utf8'), /__adobe_cep__/);
  await assert.rejects(installPanel({ destination, apply: true }), /refusing overwrite/);
  assert.deepEqual(await fs.readFile(path.join(result.target, 'host', 'aebridge.jsx')), host);
});

test('concurrent installers reserve a new target exactly once', async t => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-cep-race-'));
  t.after(() => fs.rm(destination, { recursive: true, force: true }));
  const outcomes = await Promise.allSettled([installPanel({ destination, apply: true }), installPanel({ destination, apply: true })]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(row => row.status === 'rejected').length, 1);
});
