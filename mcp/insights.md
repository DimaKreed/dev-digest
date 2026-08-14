# Insights — mcp

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

### `process.exit()` in a CLI entry point aborts the process in libuv on Windows instead of exiting
**Symptom:** `node bin/devdigest.mjs review` printed its whole report and then died with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and
exit code 127 — which reads as a crash in the command, not as a stdio problem. It reproduced
running `src/cli.ts` under `tsx` directly, so it is not the `bin` shim. The output was already
complete, so nothing in the logic had failed: `exit()` tears the stdout handle down while the
write is still draining.
**Rule:** set `process.exitCode` and let node leave once the stream flushes; never call
`exit()` on a path that has written to stdout. This bites twice in a shim-plus-entry pair —
the child's `exit()` and the parent's `child.on('exit', () => process.exit(code))` are both
hazards, and `stdio: 'inherit'` means they share the same handles.
`src/cli.ts` · `bin/devdigest.mjs`
_2026-08-14_

### A `bin` target cannot be the TypeScript entry, because this package emits no JS
**Symptom:** adding `"bin": {"devdigest": "./src/cli.ts"}` looks right until it is installed
or linked — node cannot execute a `.ts` file, and `npm run build` here is `tsc --noEmit`, so
there is never a `dist/` to point at.
**Rule:** the bin is a small `.mjs` shim that re-executes the TS entry under `tsx`, which is
already a devDependency and is how `npm start` runs the MCP server. Spawn
`node_modules/tsx/dist/cli.mjs` under `process.execPath` — **not** `node_modules/.bin/tsx`,
whose Windows `.cmd` shim needs `shell: true`, and a shell concatenates rather than escapes
the forwarded arguments (`[DEP0190] DeprecationWarning: Passing args to a child process with
shell option true can lead to security vulnerabilities`). Going to the JS entry keeps one
argv vector on every platform. `bin/devdigest.mjs`
_2026-08-14_

### The MCP SDK validates `structuredContent` only when the tool declared an `outputSchema` — and declaring one converts a shape drift into a JSON-RPC error
**Symptom:** it reads as though structured output requires a matching `outputSchema` to be
legal, so every tool looks obliged to declare one. It is not: `validateToolOutput` returns
immediately when `tool.outputSchema` is absent
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:185-207`, SDK 1.30.0), so
`structuredContent` passes through unvalidated. Declaring one flips the failure mode — a
mismatch throws `McpError(ErrorCode.InvalidParams, 'Output validation error: Invalid structured
content for tool <name>')`.
**Rule:** for a tool whose data comes from an API this package does not version, leave
`outputSchema` off and keep returning `structuredContent`. A JSON-RPC error is the one failure
shape a calling model cannot read recovery advice out of, and this package deliberately routes
every business failure through `isError: true` instead (`src/transport/tools.ts`). The payload
is already validated once at the real boundary, by the narrow schemas in `src/contracts.ts`.
Two details that decide borderline cases: a result carrying `isError: true` skips output
validation entirely, and an `outputSchema` with no `structuredContent` is itself an error —
so declaring one makes structured output mandatory for every success path of that tool.
_2026-08-13_

## Recurring Errors & Fixes

## Session Notes

## Open Questions
