# engineering-insights — what passes the bar

The ✓ entries below are **illustrative shapes, not recorded findings** — real entries live in
the `insights.md` files. The ✗ entries in *Already documented* are real facts from this repo,
and they are the most important part of this file: restating documentation is the main way
these files rot.

## Vague → specific

✗ **Too vague to act on**

```markdown
### Integration tests are slow and sometimes hang
```

✓ **Same observation, actionable cold**

```markdown
### A 120 s wait in the integration lane is the testcontainers startup budget, not a hang
**Symptom:** `pnpm exec vitest run .it.test` sat silent for ~2 min, looked deadlocked.
**Rule:** wait it out; only treat it as a hang past the timeout. Docker absent ⇒ the lane
self-skips instead. `server/test/helpers/pg.ts`
_2026-07-30_
```

✗ **Names a hazard without a rule**

```markdown
### Be careful with the score field coming back from the model
```

✓ **Says what to do instead, with the anchor**

```markdown
### The engine's score is recomputed, so a prompt change cannot move it
**Symptom:** tuned the prompt to grade harder; the returned score never budged.
**Rule:** severity counts drive the score — change the penalties in `scoreFromFindings`, not
the prompt. `reviewer-core/src/review/reduce.ts`
_2026-07-30_
```

## Already documented — do not write

Each of these fails bar test 4. They are already in a `CLAUDE.md` that the agent has loaded.

- ✗ *"Migrations don't run on boot — run `pnpm db:migrate`"* → `server/CLAUDE.md` › Gotchas.
- ✗ *"A new module isn't live until it's listed in `src/modules/index.ts`"* →
  `server/CLAUDE.md` › Conventions.
- ✗ *"vitest ignores tsconfig paths; aliases must be re-declared per package"* → root
  `CLAUDE.md` › Cross-module wiring **and** `client/CLAUDE.md` › Gotchas.
- ✗ *"`client/src/vendor/shared/` is a diverged copy of the server's contracts"* → both
  root and `client/CLAUDE.md`.

A finding *adjacent* to a documented fact can still qualify — but only if it adds the part the
docs don't have (a specific failure mode, a resolution order, a command that reproduces it).

## Never write

- ✗ *"The `ci`, `eval`, `knowledge`, `skills`, `context` and `ops` tables have no rows or
  queries — propose removing them."* Root `CLAUDE.md` › **Do not touch** declares them
  intentional course scaffolding. Same for the unused `client/messages/en/*.json` namespaces.
- ✗ *"Consider adding ESLint/Prettier."* Root `CLAUDE.md` › Conventions forbids it.
- ✗ *"Async code needs care."* Generic knowledge; no anchor; not about this repo.

## What Doesn't Work — write it even when the task succeeded

The section skipped most often. A dead end that cost time is a finding on its own:

```markdown
### Mocking the LLM provider at the module boundary doesn't work for grounding tests
**Symptom:** stubbed the provider export directly; grounding still ran against real diff
offsets and dropped every finding, so the assertion never saw them.
**Rule:** inject through the port and swap it in the container instead — grounding needs the
real diff, only the provider is fake. `server/src/adapters/mocks.ts`
_2026-07-30_
```

## Why each ✗ fails

| ✗ example | Fails bar test |
|---|---|
| "Integration tests are slow" | 2 — not actionable, no anchor (3) |
| "Be careful with the score" | 2 — names a hazard, no rule |
| "Migrations don't run on boot" | 4 — already in `server/CLAUDE.md` |
| "Remove the empty tables" | 4 — contradicts *Do not touch* |
| "Async code needs care" | 1, 2, 3 — obvious, unactionable, unanchored |
