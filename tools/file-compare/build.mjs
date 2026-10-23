import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const worker = await build({ entryPoints: ['src/worker.mjs'], bundle: true, write: false, format: 'iife', minify: true, target: 'es2022', legalComments: 'inline' });
const app = await build({ entryPoints: ['src/app.mjs'], bundle: true, write: false, format: 'iife', minify: true, target: 'es2022',
  define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) }, legalComments: 'inline' });
const css = await readFile('src/style.css', 'utf8');
const notices = await readFile('THIRD-PARTY-NOTICES.txt', 'utf8');
const template = await readFile('src/index.html', 'utf8');
const html = template.replace('/* APP_STYLE */', () => css)
  .replace('/* APP_SCRIPT */', () => app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))
  .replace('THIRD_PARTY_NOTICES', () => notices.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
await mkdir('dist', { recursive: true });
await writeFile('dist/file-compare.html', html);
console.log(`${html.length} characters; sha256 ${createHash('sha256').update(html).digest('hex')}`);
