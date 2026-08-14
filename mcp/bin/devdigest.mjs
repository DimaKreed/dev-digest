#!/usr/bin/env node
/**
 * The `devdigest` bin target.
 *
 * This package ships TypeScript and emits no JS — the same choice `server/` and
 * `reviewer-core/` make — so the bin cannot be the CLI itself. It re-executes
 * `src/cli.ts` under `tsx`, which is already a devDependency here and is how
 * `npm start` runs the MCP server.
 *
 * The child inherits all three stdio streams, so stdout stays pipeable
 * (`devdigest review --json | jq`) and the exit code passes through unchanged —
 * which is the whole contract of this command.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'cli.ts');

// tsx's own JS entry point, run under this same node — NOT the `.bin` shim.
// The shim is a `.cmd` on Windows, which needs `shell: true` to launch, and a
// shell would concatenate rather than escape the arguments this command
// forwards. Going straight to the JS keeps one argv vector on every platform.
const tsxCli = join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('error', (error) => {
  process.stderr.write(`devdigest: could not start (${error.message})\n`);
  process.exitCode = 2;
});
// `exitCode`, not `exit()`: the child's output is inherited on these same
// streams, and exiting outright can tear them down mid-flush. A signal death
// reports a null code; 2 is this CLI's "could not review".
child.on('exit', (code) => {
  process.exitCode = code ?? 2;
});
