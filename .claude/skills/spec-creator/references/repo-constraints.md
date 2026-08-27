# Repo constraints a spec author cannot derive

Facts about this repository that change what a spec may state, gathered here because they are
scattered across `CLAUDE.md` files, skill bodies and a PR-gate invariant list — none of which a
spec author should load wholesale. Loading `onion-architecture` or `frontend-ui-architecture` to
recover the four lines that matter drags 160 lines of import-direction rules into a requirements
document, which is the failure this file exists to prevent.

Read this in pass 4 (design analysis) and again before writing `## Inputs and provenance` and
`## Untrusted inputs`.

Every claim below carries its source. Where a claim is about *current* state rather than a rule,
it says so — those go stale, and a `Grep` before relying on one costs nothing.

## The contract copies have already diverged

`@devdigest/shared` exists twice: canonical in `server/src/vendor/shared/`, a copy in
`client/src/vendor/shared/`. They are **not** kept in sync mechanically, and
`adapters.ts`, `eval-ci.ts`, `knowledge.ts`, `productionize.ts` and `trace.ts` **already differ**
(`.claude/skills/pr-self-review/invariants.md:96-98`).

For a spec this is a provenance hazard, not a refactor task. A criterion that says "the client
shows the field the server returns" is under-specified when the two sides disagree about whether
that field exists. Name which copy your criterion is written against.

The PR gate blocks a diff that changes one copy without the other
(`invariants.md:15`, slug `contract-copies-diverged`), so a spec that requires a contract change
is requiring a two-package change. Say so in `## Goals / Non-goals`.

## There is no validation on the client

`@devdigest/shared` is imported into `client/` as **types only** — a runtime import breaks the
Next build, and the gate enforces it (`invariants.md:26`, slug `shared-runtime-import`).
Consequence, stated outright at `.claude/skills/frontend-ui-architecture/SKILL.md:97-98`:

> There is no Zod parsing on the client; API responses are typed, not validated.

So the client trusts the API's shape at runtime. Any criterion of the form "WHEN the API returns
an unexpected shape, the UI shall …" is describing behavior that **does not exist today** — it is
a real requirement, and it needs its own `AC-NN` rather than being assumed.

## Validation on the server happens before the handler

Schema-first: Zod `params` / `body` / `response` are declared on the route and the type provider
rejects with **422 before the handler runs** (`onion-architecture/SKILL.md:102-104`, rule H10;
`server/CLAUDE.md:52-53`). Hand-rolled `.parse()` in a handler is forbidden.

A criterion about bad input therefore specifies **422**, not 400, and not a message the handler
composes. If your spec needs a different status or a custom body for invalid input, that is a
deviation from H10 and belongs in `## Open questions`.

## Multi-write sequences are mostly non-atomic

`server/` has exactly **one** `.transaction(` call today — `ConventionsRepository.rescanForRepo`
— and *at least four other multi-write sequences are still non-atomic*
(`onion-architecture/SKILL.md:89-99`, rule H9; current state, verify before relying on it).

This is `## Edge cases` material and it is routinely missed. If a feature writes twice, the spec
must say what a reader observes when the first write lands and the second fails: a partial row, a
retry that duplicates, or an atomicity requirement that forces a unit-of-work port. Silence here
ships the partial state as the answer.

## Ring 0 is deterministic

`reviewer-core/` may not touch `fs`, `node:*`, `postgres`, `octokit`, `drizzle-orm`,
`process.env`, `Date.now()`, `new Date()`, `Math.random()` or `fetch(`. The gate blocks it
(`invariants.md:22`, slug `ring-0-impure`; onion rule C5).

For a `reviewer-core/specs/` spec this is a behavioral property, not a layering rule: the engine's
output is a pure function of its inputs. A criterion that needs the current time or a random
sample is specifying that the value be **passed in**. `reviewer-core/specs/README.md` already
requires a spec there to be expressible as a test; determinism is why that is possible.

## The output vocabulary is closed

Severity is `CRITICAL | WARNING | SUGGESTION`; verdict is `request_changes | approve | comment`.
Adding or removing a value in `Severity`, `FindingCategory`, `FindingKind` or `Verdict` trips the
gate (`invariants.md:17`, slug `output-vocabulary-changed`). A criterion inventing a fourth
severity is wrong; a spec that genuinely needs one is proposing a contract change in both copies.

## Several flags degrade silently rather than erroring

`EMBEDDINGS_ENABLED=false` and `REPO_INTEL_ENABLED=false` **silently degrade behavior rather than
erroring**; `NODE_ENV=test` silences logs and disables the global rate limit; `LOG_LEVEL` is empty
in `.env.example` and must stay tolerated (`server/CLAUDE.md:69-72`).

This is exactly what the EARS *optional feature* pattern is for, and the trap is specifying only
the enabled path:

- `WHERE embeddings are enabled, the system shall …`
- `IF embeddings are disabled, THEN the system shall …` — and the second criterion has to say
  what the user *sees*, because today the degradation is invisible.

## Grounding drops findings silently

Findings that do not map to real diff lines are **dropped, not flagged** — a review returning
fewer findings than the model emitted is working as designed (`server/CLAUDE.md:73-74`).

Any spec about counts, totals or "all findings" has to reckon with this. "The system shall display
every finding the model produced" is unsatisfiable by design.

## Migrations do not run on boot

`relation "…" does not exist` means `pnpm db:migrate` was not run (`server/CLAUDE.md:64`). A spec
requiring a new column is requiring a migration step in the deployment path, not just a schema
edit. Non-goals is the honest place for that if the spec does not own it.

## Scaffolding that must not be specified away

The root `CLAUDE.md` § *Do not touch* protects empty tables in
`server/src/db/schema/{ci,eval,knowledge,skills,context,ops}.ts` and the unused namespaces
`blast`, `brief`, `conformance`, `conventions`, `eval`, `memory`, `skills`, `compose` in
`client/messages/en/*.json`. Deletions in either trip the gate (`invariants.md:18-19`, slug
`do-not-touch-deleted`).

They are intentional course scaffolding. A spec may **use** one of those namespaces or tables; it
may never require removing one, and "clean up unused namespaces" is never a goal.

## Client-side placement facts that are observable

Three of these are behavior rather than structure, and they constrain criteria:

- **View state lives in the URL** — tab, filter, deep link, drawer
  (`frontend-ui-architecture/SKILL.md:58`). So a criterion about a filter is also a criterion
  about a shareable link surviving a reload. State it.
- **Every user-facing string comes from a next-intl namespace** — no inline literals
  (`client/CLAUDE.md:37`). A criterion quoting UI copy is quoting a key's value, and changing that
  copy is an `en` message change, not a component change.
- **There is no `loading.tsx`, `error.tsx` or `not-found.tsx`** — those states render inline from
  query state (`frontend-ui-architecture/SKILL.md:133-135`). So loading, empty and error are not
  free framework behavior here: each one is a state your spec has to require explicitly, or it
  will not exist.

## Only `en` exists

`client/messages/` holds `en/` alone. There is no locale negotiation, no plural or date-format
convention, no RTL handling. A spec that assumes a second locale is specifying new
infrastructure — put it in `## Open questions`, not in a criterion.
