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
