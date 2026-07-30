---
name: engineering-insights
description: Reads and appends durable engineering findings to the insights.md of the module a task touched (server, client, reviewer-core, e2e, or the repo root for cross-module findings). Use at the start of work in a module to load prior findings, mid-task when something non-obvious is confirmed, and at the end of any non-trivial session to record what was learned. Also use when the user invokes /engineering-insights or asks to capture, record, prune, or review insights or learnings.
allowed-tools: Read, Glob, Grep, Edit
argument-hint: "[optional: module, or the finding to capture]"
---

# Engineering insights

Durable findings live in the `insights.md` of the module they belong to, under fixed sections.
Three modes:

- **Load** — before touching code in a module, read its `insights.md`.
- **Capture** — mid-task, the moment something non-obvious is confirmed.
- **Wrap-up** — at the end of a task, append what qualifies.

## Routing — exactly one file owns a finding

| Task touched | File |
|---|---|
| `server/**` | `server/insights.md` |
| `client/**` | `client/insights.md` |
| `reviewer-core/**` | `reviewer-core/insights.md` |
| `e2e/**` | `e2e/insights.md` |
| package wiring, shared contracts, CI, `scripts/`, tooling, local setup | `insights.md` (root) |

A finding true of two packages is a cross-module finding — it goes to root, not into both.
Never mirror an entry across files.

## Load

Read the file for the module in play, plus root when the task crosses packages. Then state
**the top 3 entries that bear on this task, one line each**, before writing code. If the
sections are empty, say `no prior findings for <module>` — don't skip the line silently.

Treat entries as high-confidence guidance unless the code contradicts them. If it does, that
contradiction is itself a finding.

## The bar

A finding qualifies only if **all four** hold:

1. Non-obvious to someone reading the code.
2. Actionable cold — the reader knows what to *do*, not merely that a hazard exists.
3. Has a concrete anchor: `file:line`, an exact command, or the error string.
4. Not already in that module's `CLAUDE.md`, `README.md`, `TESTING.md`, `docs/`, or an
   existing `insights.md` entry.

Never write: generic programming knowledge, a one-off incident unlikely to recur, a restatement
of `CLAUDE.md`, or a "this looks like dead code" observation about anything root `CLAUDE.md`
lists under *Do not touch*.

Good and bad pairs from this repo: [examples.md](examples.md).

## Sections

Append inside the matching `##` heading — never invent a new one.

| Section | Takes |
|---|---|
| What Works | an approach that held up and is worth reusing |
| What Doesn't Work | a dead end and why. **Most valuable, most skipped** — a failed approach counts even when the task ultimately succeeded |
| Codebase Patterns | a convention or structural rule discovered but undocumented |
| Tool & Library Notes | a quirk of a dependency, CLI or runtime |
| Recurring Errors & Fixes | an error seen more than once, with its fix |
| Session Notes | one dated entry per session, ≤3 lines, only when the session earns a paragraph |
| Open Questions | something unresolved, phrased so the next session can pick it up |

## Entry format

    ### <the claim, as a statement>
    **Symptom:** what was seen first.
    **Rule:** what to do instead. `path/to/file.ts:41`
    _2026-07-30_

## Dedupe and append discipline

Grep the target file for the claim's key terms **before** writing. If a matching entry exists,
extend or correct it with a dated line — never add a second entry for the same claim. Never
overwrite or delete an existing entry; a superseded claim gets a dated correction underneath
it. If two entries contradict, resolve it in the file rather than leaving the next agent to
pick one at random.

## Wrap-up

1. **Does the session qualify?** Fewer than ~3 substantive user turns, or no problem solved /
   decision made / discovery ⇒ stop here, write nothing, say so.
2. Collect candidates — at most 5.
3. Apply the bar to each; drop what fails.
4. Read the target file(s) and dedupe per above.
5. Show each surviving entry **as its exact final text**, not as a title — then append it.

0 entries is a valid and common outcome. Say "nothing durable this session" rather than
manufacturing an entry.

## Hygiene

A stale entry is worse than no entry — when reviewing a file, prune what no longer holds. Past
~400 lines, split it into `insights-<domain>.md` beside it and link that from the header.
