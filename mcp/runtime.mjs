import {spawn} from 'node:child_process';
import {realpath, lstat, mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const delivery = path.join(ROOT, 'skills/asset-delivery/scripts/delivery_manifest.py');
const verifier = path.join(ROOT, 'skills/reference-to-web-toy/scripts/verify_static_artifact.py');
const builder = path.join(ROOT, 'skills/blender-production/scripts/product_scene.py');
const inspector = path.join(ROOT, 'skills/blender-production/scripts/inspect_scene.py');

export class Runtime {
  constructor(workspace, {python = 'python', blender = 'blender'} = {}) {
    this.workspace = workspace;
    this.python = python;
    this.blender = blender;
    this.children = new Set();
    this.stoppers = new Set();
    this.closed = false;
    this.blenderTail = Promise.resolve();
  }
  static async create(workspace, options) {
    const root = await realpath(path.resolve(workspace));
    if (!(await lstat(root)).isDirectory()) throw new Error('Workspace must be an existing directory');
    return new Runtime(root, options);
  }
  async scoped(input) {
    if (typeof input !== 'string' || !input || input.includes('\0')) throw new Error('Expected a workspace path');
    const target = path.resolve(this.workspace, input);
    let ancestor = target;
    const tail = [];
    while (true) {
      try { await lstat(ancestor); break; }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        tail.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    const resolved = path.join(await realpath(ancestor), ...tail);
    const relative = path.relative(this.workspace, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Path escapes the configured workspace');
    }
    return resolved;
  }
  async run(command, args, {timeout = 120000, codes = [0]} = {}) {
    if (this.closed) throw new Error('Runtime is closed');
    return await new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32';
      const child = spawn(command, args, {cwd: this.workspace, shell: false, windowsHide: true, detached: grouped,
        stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, PYTHONUTF8: '1'}});
      this.children.add(child);
      let stdout = '', stderr = '', failure, escalation, settled = false, stopping = false;
      const signal = value => {
        if (!child.pid) return;
        try {
          if (grouped) process.kill(-child.pid, value);
          else child.kill(value);
        } catch (error) {
          if (error.code !== 'ESRCH') failure ??= error;
        }
      };
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(escalation);
        // A wrapper can close before its descendants, even when their pipes are ignored.
        if (stopping && grouped) signal('SIGKILL');
        this.children.delete(child);
        this.stoppers.delete(stop);
        if (failure) reject(failure);
        else if (!codes.includes(code)) reject(new Error(`Tool exited ${code}: ${(stderr || stdout).slice(-4000)}`));
        else resolve({code, stdout, stderr});
      };
      const stop = message => {
        failure ??= new Error(message);
        if (stopping || settled) return;
        stopping = true;
        signal('SIGTERM');
        escalation = setTimeout(() => {
          signal('SIGKILL');
          child.stdout.destroy();
          child.stderr.destroy();
          // Escaped descendants may retain pipe handles; never wait for them indefinitely.
          finish(null);
        }, 500);
      };
      this.stoppers.add(stop);
      const timer = setTimeout(() => stop('Tool timed out; inspect partial output before retrying'), timeout);
      child.stdout.on('data', data => {
        if (failure) return;
        stdout += data.toString();
        if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) stop('Tool output exceeded 4 MiB');
      });
      child.stderr.on('data', data => {
        stderr = (stderr + data.toString()).slice(-16384);
      });
      child.on('error', error => { failure ??= error; });
      child.on('close', finish);
    });
  }
  async pythonJson(script, args, options) {
    const result = await this.run(this.python, [script, ...args], options);
    return JSON.parse(result.stdout);
  }
  async status() {
    const probe = async (command, args) => {
      try {
        const r = await this.run(command, args, {timeout: 15000});
        return {available: true, version: r.stdout.trim().split(/\r?\n/)[0]};
      } catch (error) { return {available: false, error: error.message}; }
    };
    return {workspace: this.workspace, node: process.version,
      python: await probe(this.python, ['--version']), blender: await probe(this.blender, ['--version']),
      requirements: {python: '3.12+', blender: '4.5+; Cycles; CPU or supported GPU'},
      note: 'Availability is a version probe, not a render or visual-quality check'};
  }
  async inventory(target) {
    return this.pythonJson(delivery, [await this.scoped(target)]);
  }
  async compare(reference, target) {
    const baseline = await this.inventory(reference);
    const destination = await this.scoped(target);
    const temp = await mkdtemp(path.join(os.tmpdir(), 'designer-compare-'));
    try {
      const file = path.join(temp, 'baseline.json');
      await writeFile(file, JSON.stringify(baseline));
      return await this.pythonJson(delivery, [destination, '--compare', file], {codes: [0, 1]});
    } finally { await rm(temp, {recursive: true, force: true}); }
  }
  async verify({root, entry = 'index.html', assets = [], url, zip_path, zip_prefix}) {
    const folder = await this.scoped(root);
    // Resolve every declared local input; the Python verifier also rejects child links.
    await this.scoped(path.resolve(folder, entry));
    for (const item of assets) await this.scoped(path.resolve(folder, item));
    const args = ['--root', folder, '--entry', entry];
    for (const item of assets) args.push('--asset', item);
    if (url) args.push('--url', url);
    if (zip_path) args.push('--zip', await this.scoped(zip_path));
    if (zip_prefix) args.push('--zip-prefix', zip_prefix);
    return this.pythonJson(verifier, args, {codes: [0, 1]});
  }
  async createProduct({spec, output_directory, render = false, device = 'CPU'}) {
    return this.serialBlender(() => this.buildProduct({spec, output_directory, render, device}));
  }
  serialBlender(fn) {
    const task = this.blenderTail.then(fn);
    this.blenderTail = task.catch(() => {});
    return task;
  }
  async buildProduct({spec, output_directory, render, device}) {
    const out = await this.scoped(output_directory);
    const temp = await mkdtemp(path.join(os.tmpdir(), 'designer-product-'));
    try {
      const file = path.join(temp, 'spec.json');
      await writeFile(file, JSON.stringify(spec));
      const args = ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1',
        '--python', builder, '--', '--spec', file, '--out', out, '--device', device];
      if (render) args.push('--render');
      await this.run(this.blender, args, {timeout: 600000});
      return JSON.parse(await readFile(path.join(out, 'build.json'), 'utf8'));
    } finally { await rm(temp, {recursive: true, force: true}); }
  }
  async inspect({blend_path, output_directory, render_check = false, device = 'CPU'}) {
    return this.serialBlender(() => this.inspectBlend({blend_path, output_directory, render_check, device}));
  }
  async inspectBlend({blend_path, output_directory, render_check, device}) {
    const blend = await this.scoped(blend_path), out = await this.scoped(output_directory);
    const args = ['--background', '--factory-startup', '--disable-autoexec', blend, '--python-exit-code', '1',
      '--python', inspector, '--', '--out', out, '--device', device];
    if (render_check) args.push('--render-check');
    await this.run(this.blender, args, {timeout: 600000});
    return JSON.parse(await readFile(path.join(out, 'inspection.json'), 'utf8'));
  }
  close() {
    this.closed = true;
    for (const stop of this.stoppers) stop('Runtime closed while a tool was running; inspect partial output before retrying');
  }
}
