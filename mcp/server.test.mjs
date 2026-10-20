import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, mkdir, rm, readFile, symlink} from 'node:fs/promises';
import net from 'node:net';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
test('server starts through an npm-style symlink path', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-bin-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  let entry;
  if (process.platform === 'win32') {
    await symlink(path.dirname(server), path.join(dir, 'linked'), 'junction');
    entry = path.join(dir, 'linked/server.mjs');
  } else {
    entry = path.join(dir, 'designer-tools-mcp');
    await symlink(server, entry);
  }
  const transport = new StdioClientTransport({command: process.execPath, args: [entry, '--workspace', dir], stderr: 'pipe'});
  const client = new Client({name: 'designer-bin-test', version: '1.0.0'});
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
  } finally { await client.close(); }
});
test('real MCP stdio initialize, list, tool success/failure and clean shutdown', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-mcp-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets/image.txt'), 'fixture');
  const transport = new StdioClientTransport({command: process.execPath,
    args: [server, '--workspace', dir, '--python', process.env.PYTHON || 'python', '--blender', 'designer-blender-missing'], stderr: 'pipe'});
  let stderr = '';
  transport.stderr?.on('data', b => { stderr += b; });
  const client = new Client({name: 'designer-test', version: '1.0.0'});
  t.after(() => client.close());
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 6);
  assert.equal(tools.some(x => x.name === 'run_jsx'), false);
  const decode = result => JSON.parse(result.content[0].text);
  const status = decode(await client.callTool({name: 'designer_tools_status', arguments: {}}));
  assert.equal(status.blender.available, false);
  assert.equal(status.ae.enabled, false);
  const result = await client.callTool({name: 'asset_inventory', arguments: {path: 'assets'}});
  assert.equal(result.isError, false);
  assert.equal(decode(result).file_count, 1);
  const bad = await client.callTool({name: 'asset_inventory', arguments: {path: '..'}});
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /escapes/);
  const missing = await client.callTool({name: 'blender_create_product', arguments: {spec: {}, output_directory: 'build'}});
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /ENOENT/);
  await client.close();
  assert.equal(stderr, '');
});

test('MCP optional AE registration, mock panel calls and script opt-in', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'designer-mcp-ae-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const allow of [false, true]) {
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const token = 'synthetic-test-token-'.repeat(3);
    const transport = new StdioClientTransport({command: process.execPath, args: [server,
      '--workspace', dir, '--ae-port', String(port), '--ae-token', token,
      '--ae-jobs', path.join(dir, 'jobs-' + allow), ...(allow ? ['--allow-ae-scripts'] : [])], stderr: 'pipe'});
    const client = new Client({name: 'designer-ae-test', version: '1.0.0'});
    let panel;
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(x => x.name);
      assert.equal(names.length, allow ? 9 : 8);
      assert.equal(names.includes('run_jsx'), allow);
      const disconnected = JSON.parse((await client.callTool({name: 'ae_status', arguments: {}})).content[0].text);
      assert.equal(disconnected.native, null);
      panel = new WebSocket(`ws://127.0.0.1:${port}/ae`);
      await once(panel, 'open');
      const authenticated = once(panel, 'message');
      panel.send(JSON.stringify({token}));
      await authenticated;
      panel.on('message', async raw => {
        const job = JSON.parse(String(raw));
        const args = JSON.parse(await readFile(job.argsPath, 'utf8'));
        const value = job.call === 'list_comps' ? {ok: true, comps: [{name: 'Fixture'}]}
          : {ok: true, result: args.code};
        await writeFile(job.resultPath, JSON.stringify(value));
        panel.send(JSON.stringify({id: job.id, ok: true}));
      });
      const comps = await client.callTool({name: 'comp_list', arguments: {}});
      assert.equal(comps.isError, false);
      assert.equal(JSON.parse(comps.content[0].text).comps[0].name, 'Fixture');
      if (allow) {
        const ran = await client.callTool({name: 'run_jsx', arguments: {code: 'return app.version;'}});
        assert.equal(JSON.parse(ran.content[0].text).result, 'return app.version;');
      }
    } finally {
      await client.close();
      panel?.terminate();
    }
    const released = net.createServer();
    await new Promise((resolve, reject) => { released.once('error', reject); released.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => released.close(resolve));
  }
});
