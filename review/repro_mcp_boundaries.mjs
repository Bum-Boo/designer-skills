// Synthetic, self-contained review harness (2026-10-23). POSIX only (uses /bin/sh wrappers, ln).
// Starts the real stdio MCP server against a NEW temporary workspace and calls only documented tools.
// No real Blender/AE is used: "blender" is a missing name or a synthetic /bin/sh stub inside the temp dir.
// Run from the repository root:  node review/repro_mcp_boundaries.mjs
import {mkdtemp, mkdir, writeFile, rm, symlink, link, chmod, readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const server = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
const python = process.env.PYTHON || 'python3';
const base = await mkdtemp(path.join(os.tmpdir(), 'designer-review-'));
const ws = path.join(base, 'workspace'), outside = path.join(base, 'outside');
const rows = [];
const record = (id, observed, expectation) => { rows.push({id, observed, expectation}); console.log(JSON.stringify({id, observed, expectation})); };

async function connect(extra = []) {
  const transport = new StdioClientTransport({command: process.execPath,
    args: [server, '--workspace', ws, '--python', python, ...extra], stderr: 'pipe'});
  const client = new Client({name: 'designer-review', version: '0.0.0'});
  await client.connect(transport);
  return client;
}
const call = async (client, name, args, options) => {
  const r = await client.callTool({name, arguments: args}, undefined, options);
  let body; try { body = JSON.parse(r.content[0].text); } catch { body = r.content[0].text.slice(0, 200); }
  return {isError: r.isError, body};
};

try {
  await mkdir(ws); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'outside-bytes');
  await mkdir(path.join(ws, 'approved')); await mkdir(path.join(ws, 'delivery'));
  await writeFile(path.join(ws, 'approved/a.txt'), 'A'); await writeFile(path.join(ws, 'delivery/a.txt'), 'B');
  await mkdir(path.join(ws, 'same')); await writeFile(path.join(ws, 'same/a.txt'), 'A');
  await mkdir(path.join(ws, 'same/empty-dir'));
  execFileSync(python, ['-I', '-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1], "w").writestr("a.txt", "A")', path.join(ws, 'approved.zip')]);
  await symlink(outside, path.join(ws, 'link-out'));
  await symlink(path.join(outside, 'missing'), path.join(ws, 'dangling-out'));
  await mkdir(path.join(ws, 'site')); await writeFile(path.join(ws, 'site/index.html'), '<!doctype html><title>x</title>');
  await writeFile(path.join(ws, 'site-real.css'), 'body{}');
  await symlink(path.join(ws, 'site-real.css'), path.join(ws, 'site/style.css')); // in-workspace, outside root
  await mkdir(path.join(ws, 'site/css')); await writeFile(path.join(ws, 'site/css/real.css'), 'p{}');
  await symlink('css/real.css', path.join(ws, 'site/inroot-link.css')); // child link that stays in root
  await mkdir(path.join(ws, 'hard'));
  let hard = 'created';
  try { await link(path.join(outside, 'secret.txt'), path.join(ws, 'hard/secret.txt')); } catch (e) { hard = e.code; }

  const client = await connect(['--blender', 'designer-review-missing-blender']);
  try {
    const cmp = await call(client, 'asset_compare', {reference_path: 'approved', delivery_path: 'delivery'});
    record('compare-mismatch-isError', {isError: cmp.isError, match: cmp.body.comparison?.match, changed: cmp.body.comparison?.changed},
      'Mismatch is a normal result: isError=false; caller must read comparison.match');
    const same = await call(client, 'asset_compare', {reference_path: 'approved.zip', delivery_path: 'same'});
    record('compare-zip-vs-folder-content-only', {isError: same.isError, match: same.body.comparison?.match, kind: same.body.kind},
      'Content comparison: archive bytes/kind and empty directories are not compared');
    const ver = await call(client, 'verify_web_artifact', {root: 'site', assets: ['missing.js']});
    record('verify-fail-isError', {isError: ver.isError, status: ver.body.status}, 'FAIL receipt is isError=true');
    for (const p of ['link-out', 'link-out/secret.txt', 'dangling-out', 'dangling-out/new', '../outside', path.join(outside, 'secret.txt')]) {
      const r = await call(client, 'asset_inventory', {path: p});
      record('inventory-boundary:' + p.replace(base, '<tmp>'), {isError: r.isError, text: typeof r.body === 'string' ? r.body : 'JSON receipt'}, 'Rejected');
    }
    const hl = await call(client, 'asset_inventory', {path: 'hard'});
    record('inventory-hardlink-to-outside-file', {hardlink: hard, isError: hl.isError, entries: hl.body.entries?.map(e => e.path)},
      'Static limitation: an in-workspace hard link to outside bytes is indistinguishable and is read');
    const s1 = await call(client, 'verify_web_artifact', {root: 'site', assets: ['style.css']});
    record('verify-asset-symlink-leaving-root', {isError: s1.isError, status: s1.body.status, failures: s1.body.failures}, 'Rejected by Python root check');
    const s2 = await call(client, 'verify_web_artifact', {root: 'site', assets: ['inroot-link.css']});
    record('verify-asset-symlink-inside-root', {isError: s2.isError, status: s2.body.status},
      'Accepted (runtime.mjs:107 comment says the verifier rejects child links; it only rejects links resolving outside root)');
    const st = await call(client, 'designer_tools_status', {});
    record('status-missing-blender', {isError: st.isError, blender: st.body.blender}, 'available=false, reported as data');
    const bl = await call(client, 'blender_create_product', {spec: {}, output_directory: 'out-missing'});
    record('create-product-missing-blender', {isError: bl.isError, text: String(bl.body).slice(0, 80)}, 'isError=true');
  } finally { await client.close(); }

  // Any executable that exits 0 is "available"; a stub that never runs the builder exposes a stale receipt.
  const stub = path.join(base, 'fake-blender.sh');
  await writeFile(stub, '#!/bin/sh\nexit 0\n'); await chmod(stub, 0o755);
  await mkdir(path.join(ws, 'stale')); await writeFile(path.join(ws, 'stale/build.json'), JSON.stringify({note: 'STALE receipt from an earlier run'}));
  const c2 = await connect(['--blender', stub]);
  try {
    const st = await call(c2, 'designer_tools_status', {});
    record('status-exit0-stub-counts-as-blender', {blender: st.body.blender}, 'Probe only checks exit code; version text is empty');
    const r = await call(c2, 'blender_create_product', {spec: {}, output_directory: 'stale'});
    record('create-product-stub-returns-stale-receipt', {isError: r.isError, body: r.body},
      'Hardening: Node trusts exit 0 + existing build.json; real builder would refuse the non-empty directory itself');
  } finally { await c2.close(); }

  // Timeout of a wrapper whose grandchild keeps stdout open (shell wrapper without exec).
  const marker = 'designer-review-' + process.pid;
  const wrapper = path.join(base, 'python-wrapper.sh');
  const sleeper = path.join(base, marker + '-sleep');
  await symlink('/bin/sleep', sleeper);
  await writeFile(wrapper, `#!/bin/sh\n"${sleeper}" 20\necho done\n`); await chmod(wrapper, 0o755);
  const c3 = new Client({name: 'designer-review', version: '0.0.0'});
  await c3.connect(new StdioClientTransport({command: process.execPath, args: [server, '--workspace', ws, '--python', wrapper, '--blender', 'designer-review-missing-blender'], stderr: 'pipe'}));
  const started = Date.now();
  const st = await call(c3, 'designer_tools_status', {}, {timeout: 60000});
  const elapsed = (Date.now() - started) / 1000;
  record('status-probe-timeout-with-grandchild', {elapsedSeconds: elapsed, python: st.body.python},
    'Probe timeout is 15 s; result should arrive near 15 s');
  // Cancellation: start a probe, abort it after 1 s, then see whether the grandchild remains.
  const controller = new AbortController();
  const pending = c3.callTool({name: 'designer_tools_status', arguments: {}}, undefined, {signal: controller.signal}).catch(e => e.message);
  await new Promise(r => setTimeout(r, 1000)); controller.abort();
  await pending;
  const alive = () => { try { return execFileSync('pgrep', ['-f', sleeper]).toString().trim().split('\n').length; } catch { return 0; } };
  record('cancel-leaves-native-child', {sleepersAfterAbort: alive()}, 'Documented: client cancellation does not stop native work');
  await c3.close();
  await new Promise(r => setTimeout(r, 500));
  record('server-close-leaves-grandchild', {sleepersAfterServerClose: alive()},
    'Server close kills direct children only (SIGTERM, no process group)');
  try { for (const pid of execFileSync('pgrep', ['-f', sleeper]).toString().trim().split('\n')) process.kill(Number(pid)); } catch {}
} finally {
  await rm(base, {recursive: true, force: true});
}
