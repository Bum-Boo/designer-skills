import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const extensionId = 'org.bumboo.designerskills.ae';
const source = fileURLToPath(new URL('./panel/', import.meta.url));
export async function installPanel({ destination, apply = false } = {}) {
  const parent = destination || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions')
      : null);
  if (!parent) throw new Error('Provide --destination on this platform');
  const target = path.resolve(parent, extensionId);
  try { await fs.lstat(target); throw new Error('Destination already exists; refusing overwrite'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!apply) return { mode: 'dry-run', source, target, unsignedCepSettingsChanged: false };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target); // Exclusive reservation. Never copy into a pre-existing target.
  try { await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true }); }
  catch (error) { throw new Error('Panel copy failed; partial installation retained at ' + target + ': ' + error.message); }
  return { mode: 'installed', target, unsignedCepSettingsChanged: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg, index) => arg !== '--apply' && arg !== '--destination' && args[index - 1] !== '--destination')) throw new Error('Unknown option');
    const at = args.indexOf('--destination');
    if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--'))) throw new Error('--destination needs a directory');
    console.log(JSON.stringify(await installPanel({ destination: at >= 0 ? args[at + 1] : undefined, apply: args.includes('--apply') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
