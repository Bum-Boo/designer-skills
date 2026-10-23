import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {Runtime} from './runtime.mjs';

async function running(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-owned-tree-'));
  const marker = path.join(dir, 'child.pid');
  const rt = await Runtime.create(dir);
  t.after(async () => {
    rt.close();
    try {
      const pid = Number(await readFile(marker, 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 1 && await running(pid)) process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
    await rm(dir, {recursive: true, force: true});
  });
  // Both wrapper and descendant ignore TERM, and the descendant holds the output pipes.
  const command = ['-c', 'trap "" TERM; sleep 30 & printf "%s" "$!" > "$1"; wait', 'owned-wrapper', marker];
  return {rt, marker, command};
}

test('timeout escalates and stops the owned POSIX wrapper group', {skip: process.platform !== 'linux', timeout: 15000}, async t => {
  const {rt, marker, command} = await fixture(t);
  const start = Date.now();
  await assert.rejects(rt.run('/bin/sh', command, {timeout: 2000}), /timed out/);
  assert.ok(Date.now() - start < 7000, 'must not wait for the 30-second descendant');
  const pid = Number(await readFile(marker, 'utf8'));
  assert.equal(await running(pid), false);
  assert.equal(rt.children.size, 0);
  assert.equal(rt.stoppers.size, 0);
});

test('close interrupts a running wrapper and stops its descendant', {skip: process.platform !== 'linux', timeout: 15000}, async t => {
  const {rt, marker, command} = await fixture(t);
  const pending = assert.rejects(rt.run('/bin/sh', command, {timeout: 10000}), /Runtime closed/);
  let pid;
  for (let i = 0; i < 100; i++) {
    try { pid = Number(await readFile(marker, 'utf8')); if (pid > 1) break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await pause(30);
  }
  assert.ok(pid > 1, 'wrapper must have started its owned descendant');
  assert.equal(await running(pid), true);
  rt.close();
  await pending;
  assert.equal(await running(pid), false);
  assert.equal(rt.children.size, 0);
});
