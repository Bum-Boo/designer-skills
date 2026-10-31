// Detached companion of one MCP server. Its stdin closes when the server exits for any
// reason, including SIGKILL; it then stops the tools still recorded in the server's pid file.
import {reapFile} from './process-tree.mjs';

// On Windows the reaper shares the server's console; Ctrl+C must not stop it before the server exits.
process.on('SIGINT', () => {});
process.stdin.resume();
process.stdin.on('error', () => {});
process.stdin.once('close', () => reapFile(process.argv[2]).finally(() => process.exit(0)));
