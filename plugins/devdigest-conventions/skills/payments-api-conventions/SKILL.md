---
name: payments-api-conventions
description: "House coding conventions for acme/payments-api, extracted from the repository's own code by DevDigest. Use when writing or reviewing TypeScript in this repository — asynchronous code, configuration access, and error handling in route handlers and middleware. Trigger terms: convention, house rule, house style, code review, .then chain, async/await, process.env, floating promise."
---

<!--
  GENERATED SAMPLE — PLACEHOLDER.

  This file is a stand-in written by hand so the plugin is installable today. It is
  modelled on the seeded `no-then-chains` convention (server/src/db/seed-skills.ts) and
  the demo repo acme/payments-api.

  A later session replaces this whole file with real DevDigest extractor output: the
  extractor mines candidate rules from the repository, verifies each one against real
  code (file + line), and merges only the accepted candidates. Rejected candidates never
  reach this file. Do not hand-edit the regenerated version — re-run the extractor.
-->

# acme/payments-api conventions

Rules the repository already follows, mined from its own code. Each rule below cites the
code it was verified against. Report a violation with the severity given; do not invent
severities of your own.

## 1. No `.then()` chains — SUGGESTION

This codebase uses `async`/`await` everywhere. A `.then()` chain in new code is a
convention violation — report it as a SUGGESTION, or a WARNING when the chain also drops
errors.

Flag:

- `.then()` / `.catch()` chains in code the diff adds or edits.
- A promise passed to `forEach`, which never awaits.
- A floating promise with no `await` and no `.catch()`.

Do not flag `.then()` inside code the diff merely moves, and never flag it in test files
where a rejection assertion reads more clearly as `.rejects`.

_Verified against_: `src/middleware/ratelimit.ts:41`, `src/api/users.ts:18` — both use
`await` for every asynchronous call.

## 2. Configuration is read through `src/config.ts` — WARNING

Every environment value is parsed once in `src/config.ts` and imported from there. A
direct `process.env.X` read outside that module skips validation and defaulting.

Flag a `process.env` access in any file other than `src/config.ts`. Point at the config
export that already covers the value, or say a new one is needed.

_Verified against_: `src/config.ts:1-34` — the single module holding every
`process.env` read in the repository.

## 3. Route handlers return errors, they do not throw strings — WARNING

Handlers under `src/api/` return a typed error response; a bare `throw new Error(...)` or
`throw 'message'` escapes to the generic 500 handler and loses the status code.

Flag a throw of a non-`Error` value anywhere, and a `throw` inside `src/api/**` that is
not re-wrapped by the module's error helper.

_Verified against_: `src/api/public/webhooks.ts:22`, `src/api/users.ts:64` — both return
a structured error object rather than throwing.

## Reporting

Use the fixed vocabulary: severity `CRITICAL | WARNING | SUGGESTION`. Name the file and
line for every finding. A rule with no matching code in the diff produces no finding —
silence is the correct output.
