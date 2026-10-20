#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {Runtime} from './runtime.mjs';
import {createAeBridge} from './ae/bridge.mjs';

export async function start(argv = process.argv.slice(2)) {
  const {values} = parseArgs({args: argv, options: {
    workspace: {type: 'string'}, python: {type: 'string'}, blender: {type: 'string'},
    'ae-port': {type: 'string'}, 'ae-token': {type: 'string'}, 'ae-jobs': {type: 'string'},
    'allow-ae-scripts': {type: 'boolean', default: false}, help: {type: 'boolean'}
  }});
  if (values.help) {
    console.error('designer-tools-mcp --workspace PATH [--python EXE] [--blender EXE]\n' +
      '  [--ae-port PORT --ae-jobs NEW_PRIVATE_DIRECTORY] [--allow-ae-scripts]\n' +
      'AE token: DESIGNER_AE_TOKEN environment variable (or --ae-token). See docs/mcp.md.');
    return;
  }
  if (!values.workspace) throw new Error('--workspace is required');
  const runtime = await Runtime.create(values.workspace, values);
  let ae, transport;
  const server = new McpServer({name: 'designer-tools', version: '0.2.0-alpha.1'});
  const result = async fn => {
    try {
      const value = await fn();
      return {isError: value?.ok === false || value?.status === 'FAIL',
        content: [{type: 'text', text: JSON.stringify(value, null, 2)}]};
    }
    catch (error) { return {isError: true, content: [{type: 'text', text: error.message}]}; }
  };
  const read = {readOnlyHint: true, destructiveHint: false, openWorldHint: false};
  const write = {readOnlyHint: false, destructiveHint: false, openWorldHint: false};
  const device = z.enum(['CPU', 'CUDA', 'OPTIX']).default('CPU');
  server.registerTool('designer_tools_status', {description: 'Probe local dependencies and optional AE panel connection.',
    inputSchema: {}, annotations: read}, () => result(async () => ({...await runtime.status(), ae: ae ? ae.status() : {enabled: false}})));
  server.registerTool('asset_inventory', {description: 'Read-only SHA-256 inventory of a workspace folder or ZIP.',
    inputSchema: {path: z.string()}, annotations: read}, a => result(() => runtime.inventory(a.path)));
  server.registerTool('asset_compare', {description: 'Compare a delivery folder/ZIP with an approved folder/ZIP. Returns match/missing/extra/changed.',
    inputSchema: {reference_path: z.string(), delivery_path: z.string()}, annotations: read},
    a => result(() => runtime.compare(a.reference_path, a.delivery_path)));
  server.registerTool('verify_web_artifact', {description: 'Check declared static files, optional loopback HTTP response and ZIP bytes. Does not exercise browser interaction.',
    inputSchema: {root: z.string(), entry: z.string().default('index.html'), assets: z.array(z.string()).default([]),
      url: z.string().optional(), zip_path: z.string().optional(), zip_prefix: z.string().optional()}, annotations: read},
    a => result(() => runtime.verify(a)));
  server.registerTool('blender_create_product', {description: 'Build an editable synthetic device template in a NEW empty output directory. Optional PNG render; inspect actual pixels separately.',
    inputSchema: {spec: z.record(z.unknown()), output_directory: z.string(), render: z.boolean().default(false), device}, annotations: write},
    a => result(() => runtime.createProduct(a)));
  server.registerTool('blender_inspect_scene', {description: 'Fresh-process .blend structure inspection and optional render in a NEW empty output directory. External FILE images only; no visual-quality verdict.',
    inputSchema: {blend_path: z.string(), output_directory: z.string(), render_check: z.boolean().default(false), device}, annotations: write},
    a => result(() => runtime.inspect(a)));
  try {
    if (values['ae-port']) {
      const port = Number(values['ae-port']);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AE port must be 1024..65535');
      const token = values['ae-token'] || process.env.DESIGNER_AE_TOKEN;
      if (!token || token.length < 32) throw new Error('Provide a private AE token of at least 32 characters');
      if (!values['ae-jobs']) throw new Error('--ae-jobs requires an explicit new private directory');
      ae = await createAeBridge({port, token, jobDirectory: values['ae-jobs'], allowScripts: values['allow-ae-scripts']});
      for (const [name, schema, description] of [
        ['ae_status', {}, 'Read connected After Effects host/project status.'],
        ['comp_list', {}, 'List compositions in the connected After Effects project.'],
        ...(values['allow-ae-scripts'] ? [['run_jsx', {code: z.string().max(100000)}, 'Execute an ExtendScript function body in After Effects. Full native app/file privileges; can change the active project.']] : [])
      ]) {
        server.registerTool(name, {description, inputSchema: schema,
          annotations: name === 'run_jsx' ? {readOnlyHint: false, destructiveHint: true, openWorldHint: true} : read},
        a => result(() => ae.call(name, a)));
      }
    } else if (values['allow-ae-scripts'] || values['ae-jobs'] || values['ae-token']) {
      throw new Error('AE options require --ae-port');
    }
    transport = new StdioServerTransport();
    await server.connect(transport);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      runtime.close();
      await ae?.close();
      await server.close();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    process.stdin.once('end', close);
    return {server, runtime, ae, close};
  } catch (error) {
    runtime.close();
    await ae?.close();
    await server.close();
    throw error;
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  start().catch(error => { console.error(error.message); process.exitCode = 1; });
}
