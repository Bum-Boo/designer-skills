// Detached companion of one MCP server. Its stdin closes when the server exits for any
// reason, including SIGKILL; it then stops the tools still recorded in the server's pid file.
import {unlinkSync} from 'node:fs';
import {ProcessTree, readRecord} from './process-tree.mjs';

const file = process.argv[2];
// On Windows the reaper shares the server's console; Ctrl+C must not stop it before the server exits.
process.on('SIGINT', () => {});
process.stdin.resume();
process.stdin.on('error', () => {});
process.stdin.once('close', async () => {
  try {
    const record = readRecord(file);
    await new ProcessTree().reap(record.tools);
  } catch {}
  try { unlinkSync(file); } catch {}
  process.exit(0);
});
