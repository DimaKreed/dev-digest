# Insights — server

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

### De-duplicating model output by its TEXT does not work here — the model rewords the same claim every call
**Symptom:** re-scan preservation keyed "already triaged" on `normalizeRule` (lowercase, collapse
whitespace, strip trailing punctuation). Against the real extractor it suppressed **0 of 4** triaged
rules and `stats.suppressed` read 0 while 4 of 6 new `pending` rows were re-wordings of rules the
user had already accepted or rejected — including a **rejected** one coming back as pending:

- accepted `Import shared types using \`import type\` from \`@devdigest/shared\`.`
  → returned as `Import shared types with \`import type\` from the \`…\` package.`
- rejected `UI text should be retrieved via the \`useTranslations\` hook…`
  → returned as `Use \`useTranslations\` from \`next-intl\` for all user-facing strings…`

`temperature: 0` is not the guarantee it looks like: OpenRouter routes each scan to a different
upstream, so wording drifts between runs even at fixed inputs.
**Rule:** key on something the model derives from the CODE, not on its prose. `suppressionKeys`
(`src/modules/conventions/helpers.ts`) matches on either the normalised rule text **or** the verified
evidence anchor `path:line`, which was byte-identical across re-scans in all four cases. Include the
LINE, not just the path or the file set: an `import type` rule and a `useTranslations` rule both cited
`AgentEditor.tsx` + `ConfigTab.tsx`, so a fileset-only key silently merges two distinct rules and
drops one. This generalises to any "did the model already tell me this?" check in this repo.
Regression guard: `test/conventions.it.test.ts` → "a rejected rule stays suppressed when the model
rephrases it" — note the older sibling case passes either way because its mock re-proposes
byte-identical text, which is exactly the case that does not occur in practice.
_2026-08-04_

## Codebase Patterns

### `no-cross-module` blocks reading another module's helper, so a per-feature model override is read from the `settings` TABLE instead
**Symptom:** `modules/conventions/service.ts` needs the workspace's `feature_models.conventions`
override, which `modules/settings/feature-models.ts` already resolves — but importing it trips
depcruise's `no-cross-module` rule (`.dependency-cruiser.cjs:83`), verified by probe.
**Rule:** a new module needing a per-feature model duplicates the resolution against its own
repository rather than importing the settings helper: read the `settings` row, `safeParse` it with
`FeatureModelChoice`, fall back to the `FEATURE_MODELS` registry default. See `resolveModel` in
`src/modules/conventions/service.ts:349` — the duplication is deliberate and commented as such.
_2026-08-04_

### `server/` now has its own first `db.transaction()`, so the onion skill's "expect 0 today" probe is stale
**Symptom:** `.claude/skills/onion-architecture/SKILL.md` states "There are currently **zero**
`.transaction(` calls in `server/`" and its H9 grep probe reads `rg -n '\.transaction\(' src` —
**expect 0 today**. That is no longer true: `ConventionsRepository.rescanForRepo`
(`src/modules/conventions/repository.ts:164`) wraps its read-existing / delete-pending / insert-fresh
sequence in one, which is the correct call for a multi-write use case (H9).
**Rule:** treat that probe as "every hit must be a deliberate transaction boundary in a repository",
not as "any hit is a violation". When adding one, keep it in the repository and let the service stay
unaware of the handle — `rescanForRepo` takes a pure key function and returns rows, so no Drizzle type
reaches ring 2.
_2026-08-04_

### `db:seed` creates no `agent_runs`, so every run-derived surface is empty on a fresh DB
**Symptom:** with cost wired end-to-end, the PR list's COST column still showed `—` on every row and
the Agent Runs timeline was empty — which reads as a broken feature but is correct: `src/db/seed.ts`
inserts through `agents` and stops, never touching `agentRuns` or `runTraces`.
**Rule:** don't debug an empty cost/tokens/duration/timeline surface on a freshly seeded DB — there
are no runs to show. Trigger one: `POST /pulls/:id/review {"agentId":…}` is fire-and-forget, so poll
`GET /pulls/:id/runs` until `status !== "running"`. For a check that survives the session, extend
`test/reviews.it.test.ts` → "runs a review: map-reduce + grounding…", which drives the real executor
on mock adapters (they report `costUsd`) and already reads the `agent_runs` row back.
_2026-07-30_

### Declaring Drizzle row types in `repository.ts` creates a pure-helper → repository import cycle
**Symptom:** `pnpm arch:all` reports
`no-circular: src/modules/agents/helpers.ts → src/modules/agents/repository.ts → src/modules/agents/helpers.ts`.
The helper is meant to be pure and only wants a type —
`import type { AgentRow, AgentVersionRow } from './repository.js'` — while `repository.ts` imports
the helper's mappers back.
**Rule:** put row/domain types in `modules/<domain>/ports.ts`, not in the repository that also holds
the query code. Both files then depend inward and the cycle disappears. `src/modules/agents/helpers.ts:3`
_2026-08-01_

**Update — the other half: `db/rows.ts` is closed to a helper too, and depcruise counts a
`import type` as an edge.** Routing the row type *around* the cycle by importing it straight from
the schema side — `import type { SkillRow } from '../../db/rows.js'` — just swaps one error for
another: `error c5-pure-helpers: src/modules/skills/helpers.ts → src/db/rows.ts`. That rule's `to`
is `^src/(db|adapters)/`, which `db/rows.ts` matches exactly as `db/schema` does, and a type-only
import erases at runtime but is still an import edge to dependency-cruiser. So for any module whose
`helpers.ts` needs a row type, `ports.ts` is not the tidier option — it is the only legal one:
`ports.ts` re-exports from `db/rows.ts`, and `helpers.ts` and `repository.ts` both import inward
from it. `src/modules/skills/ports.ts` _2026-08-03_

### A new module whose tables another repository already owns ships NO `repository.ts` — a port the container's existing repo satisfies structurally
**Symptom:** the onion skill's C1–C3 read as "a slice is `routes.ts` → `service.ts` → `repository.ts`
+ `ports.ts`", so a new `smart-diff` module looks like it needs a repository. Writing one puts a
second repository over `pr_files`, `reviews` and `findings` — tables `ReviewRepository` already owns
— which is exactly what C2 forbids. Both readings of the catalog cannot hold.
**Rule:** C3 requires that a repository have a port and that the service depend on the interface; it
does not require the slice to *contain* a repository. Declare the narrow read port in the new
module's `ports.ts`, restating the row shapes structurally (never `db/rows.ts` — that is an import
edge, see the entry above), and hand in the existing repo from the container at the route:
`new SmartDiffService({ reads: app.container.reviewRepo })`. `reviewRepo` satisfies
`SmartDiffReads` with no `implements`, no adapter and no mapper — `tsc` is the only thing that
checks it, and `pnpm arch` is blind to the relationship for the same reason it is blind to `Db`
arriving through `Container`. Reviewed and ruled compliant, not merely tolerated.
`src/modules/smart-diff/ports.ts:51` · `src/modules/smart-diff/routes.ts:24`
_2026-08-08_

## Tool & Library Notes

### A dependency-cruiser rule cannot see a type that arrives through the `Container` God object
**Symptom:** `h8-no-db-handle-above-repository` in `.dependency-cruiser.cjs` reports 0 hits even
though every service is typed against the Drizzle handle — because no service imports
`db/client.js`. `Db` arrives as `Container['db']`, and `platform/container.ts` is the only file with
the import edge.
**Rule:** depcruise validates *import edges*, so any rule about a type flowing through one injected
object is structurally blind and will pass while the violation is everywhere. Enforce those with
grep — `rg -n '\$inferSelect|PostgresJsDatabase|db/rows' src/modules/*/service.ts`. Keep the
depcruise rule anyway; it catches the day someone imports the handle directly.
`src/modules/reviews/service.ts:33`
_2026-08-01_

### Drizzle's `text(col, { enum: [...] })` is a TypeScript union only — no CHECK reaches Postgres
**Symptom:** widening the skills `source` enum with `'imported_file'` looked like it needed a
migration, but `pnpm db:generate` emitted nothing for it — which reads like drizzle-kit failing to
notice the change.
**Rule:** it did notice; there is nothing to emit. The generated DDL is a bare
`"source" text NOT NULL` (`src/db/migrations/0000_init.sql:322`), so the allowed set lives entirely
in TypeScript. Widening one is a no-migration, three-file edit: the `enum:` array in
`src/db/schema/<table>.ts` plus the matching `z.enum` in **both** `vendor/shared` copies. The
converse is the trap — *narrowing* one also generates no migration, so rows keep values the types
now claim are impossible, and the next `Zod.parse` on read throws on real data.
_2026-08-03_

## Recurring Errors & Fixes

## Session Notes

## Open Questions
