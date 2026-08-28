# Spec: Onboarding Generator — per-repo 5-section onboarding tour
Spec ID: SPEC-02
Status: implemented

## Problem and user

A developer who has just imported a repository into DevDigest has no way to be told where to
start reading it. The scaffolding for the answer is already in place and dormant: the `onboarding`
table exists (`server/src/db/schema/context.ts:120-126`), the `Onboarding` /
`OnboardingSection` / `OnboardingLink` contracts exist in both copies of `@devdigest/shared`
(`server/src/vendor/shared/contracts/knowledge.ts:28-47`), the model prompt exists
(`server/src/prompts/onboarding.system.md`), and a per-feature model default is registered
(`server/src/vendor/shared/contracts/platform.ts:43-50`). Nothing reads or writes any of it: the
only `onboarding` surface in the client is `/onboarding`, which is the **add-repository** screen
(`client/src/app/onboarding/page.tsx:1-9`), and there is no server module that produces a tour.
`client/messages/en/onboarding.json` already carries `title`, `generate.*`, `regenerate` and
`loadError.title` — copy written for a feature that was never wired.

`git log -S'onboarding' -- server/src client/src` shows no removal commit; the scaffolding arrived
with the squashed snapshot `587c46a`. This is forward scaffolding, not a stripped feature.

The cost today is that the studio can review a repository's pull requests while being unable to
say what the repository *is*, and the reading-path facts the indexer already computes
(`getCriticalPaths`, `getTopFilesByRank`, `getRepoMap`, `file_facts.endpoints` / `.crons`) are
produced and then discarded for this purpose.

## Goals / Non-goals

**Goals**
- One tour per repository, five fixed sections, generated on explicit request and persisted.
- An honest status: the tour never reads as confident when the facts under it are missing, stale,
  or were written without a model.
- Every model-cited file link verified against the indexed file set before it is shown.
- The generation reports its model-call count, tokens and cost, so a demo can verify both without
  reading server logs.

**Non-goals**
- **A share link.** The screenshot's "Share link" control has no i18n key and no backend. Named
  here so it is dropped on purpose rather than silently.
- **Tour history.** `onboarding.repo_id` is the primary key, so regeneration replaces. No versions,
  no diff between tours.
- **A schema migration.** Every field this spec adds lives inside the existing `json` jsonb column.
  No column is added and no migration is in scope.
- **Auto-regeneration on read.** A page view must not cost money, and a demo's call-count check
  must stay deterministic.
- **Resumable / job-backed generation.** The request is blocking; see Open question 1.
- **Changing `CLONE_DEPTH` or `pipeline/rank.ts`.** Hotness is 0 by the repository's recorded
  Option B decision (`server/src/modules/repo-intel/pipeline/rank.ts:4-7`); this spec surfaces that
  limitation, it does not remove it.
- **A second locale.** Only `en` exists in `client/messages/`.
- This spec adds fields to the `Onboarding` contract, and the `Onboarding*` block is currently
  byte-identical in both copies of `knowledge.ts`. Adding a field is therefore a **two-package
  change**; the PR gate blocks a one-sided edit
  (`.claude/skills/pr-self-review/invariants.md:15`, slug `contract-copies-diverged`).

## User stories

- As a developer new to an imported repository, I want a five-section tour with a ranked reading
  path, so that I know which files to open first.
- As a developer reading a tour written weeks ago, I want to be told it describes a different
  commit, so that I do not follow a path into files that have since moved.
- As an operator running the studio with no provider key, I want the generate action to be
  unavailable rather than to fail after I press it, so that I know the limitation before I spend
  the attempt.
- As a demo operator, I want the generation result to state how many model calls it made and what
  they cost, so that I can verify "exactly one call" without reading server logs.

## Acceptance criteria (EARS)

### Generation

- **AC-01** — The system shall represent a tour as exactly five sections whose `kind` values are
  `overview`, `architecture`, `key_modules`, `getting_started` and `conventions`, in that order.
- **AC-02** — WHEN a generation is requested for a repository, the system shall make exactly one
  structured model call, and shall report in the generation result the number of model calls, the
  input tokens, the output tokens and the cost in USD.
- **AC-03** — The system shall build the tour's deterministic facts from the precomputed repository
  intelligence — critical paths, file ranks, the repo map, and precomputed endpoint and cron facts —
  without reading every file of the repository in full.
- **AC-04** — The system shall derive the stack and the runnable scripts from the repository's own
  package manifest, and shall not present a script or a dependency that is absent from it.
- **AC-05** — WHEN the model returns section links, the system shall drop every link whose path is
  not present in the repository's indexed file set, and shall persist only the surviving links.
- **AC-06** — The system shall report the number of dropped links in the generation result and in
  the persisted tour, so that the drop is observable rather than silent.
- **AC-07** — The system shall persist, inside the tour document, the commit sha the tour was
  generated at.

### Preconditions and degradation

- **AC-08** — IF the repository's index is absent, or reports zero written import edges over a
  non-empty indexed file count, THEN the system shall refuse to generate and shall return a
  409-shaped error naming `POST /repos/:id/resync` as the action that resolves it.
- **AC-09** — IF the repository's index reports zero indexed files, THEN the system shall not
  classify the index as degraded and shall not refuse generation on that basis. (`SUPPORTED_EXT` is
  JS/TS only — `server/src/modules/repo-intel/constants.ts:14` — so a Python or Go repository
  indexes to zero files, and an empty repository is not a broken index.)
- **AC-10** — IF no provider key is configured for the resolved onboarding model, THEN the system
  shall present the generate and regenerate actions as unavailable before either is attempted, and
  shall state that a provider key is missing as the reason.
- **AC-11** — IF the structured model call fails after its retries, THEN the system shall persist
  and display a deterministic tour built from the facts alone, together with a banner stating that
  it was written without a model.
- **AC-12** — WHERE repository intelligence is disabled by flag, the system shall treat the index
  as unavailable, refuse generation per AC-08, and state the disabled flag as the reason rather
  than an index failure.
- **AC-13** — WHERE the index reports that hotness is unavailable, the system shall state that the
  reading-path order reflects import rank alone and does not account for change frequency.

### Reading a stored tour

- **AC-14** — WHEN a stored tour's recorded sha differs from the repository's current head, the
  system shall still display the tour, and shall display a banner stating that it was written for a
  different commit together with an action to regenerate it.
- **AC-15** — The system shall not generate or regenerate a tour as a side effect of reading one;
  generation shall occur only on an explicit request.
- **AC-16** — IF a persisted tour document lacks any field this spec introduces, THEN the system
  shall parse and display it without error, treating the field as absent. (Anything round-tripping
  through jsonb must tolerate an absent key — `insights.md:81`; `OnboardingSection.diagram` is the
  existing precedent.)

### Display

- **AC-17** — The system shall render each section's title from the `onboarding` next-intl
  namespace keyed by the section's `kind`, and shall ignore the model-supplied `title` for display.
- **AC-18** — IF a persisted section carries a `kind` outside the five named in AC-01, THEN the
  system shall not render that section. (`OnboardingSection.kind` is `z.string()` and the client
  performs no runtime validation, so an unrecognised kind arrives silently.)
- **AC-19** — The system shall render a diagram only for the `architecture` section; a diagram
  present on any other section shall not be rendered.
- **AC-20** — WHEN a user activates a section link, the system shall open
  `https://github.com/{owner}/{name}/blob/{sha}/{path}` in a new browser tab, using the sha the
  tour was generated at rather than the repository's current head.
- **AC-21** — WHILE a generation request is in flight, the system shall display a distinct
  in-progress state and shall prevent a second generation being triggered from the same view.
- **AC-22** — IF no tour exists for the selected repository, THEN the system shall display an empty
  state carrying a title, a body explaining what generation does, and the generate call to action.
- **AC-23** — IF loading a tour fails, THEN the system shall display an error state carrying a
  title, a body naming the reason, and a retry action.
- **AC-24** — WHILE a tour exists for the selected repository, the system shall present the
  regenerate action in place of the generate action.

### Concurrency, access and safety

- **AC-25** — IF two generations for the same repository complete concurrently, THEN exactly one
  tour shall survive — the one whose write completed later — and neither request shall fail.
- **AC-26** — The system shall read and write a tour only for a repository belonging to the
  requesting workspace, resolving tenancy through the repository's own workspace. (The `onboarding`
  table carries no `workspace_id`, unlike every other domain table.)
- **AC-27** — IF a request carries a malformed repository identifier, THEN the system shall reject
  it with 422 before the handler runs. (Schema-first validation, `server/CLAUDE.md:52-53`.)
- **AC-28** — The system shall treat repository file contents, the package manifest and model
  output as data and never as instructions, and shall render section bodies as markdown without
  executing embedded HTML or scripts.

## Edge cases

- **A repository whose index found zero supported files** — covered by AC-09 for the refusal path.
  What the tour then *contains* is not covered by any criterion; see Open question 7.
- **A stale tour whose linked files have since been renamed** — covered by AC-07 + AC-20: the link
  targets the sha the tour described, so it resolves rather than 404s, and AC-14 tells the reader
  the tour is not about current head.
- **Two concurrent generations** — covered by AC-25. There is deliberately no lock and no job row:
  two model calls are made and two are charged, one row survives. Accepted for a local
  single-operator tool.
- **The model cites a path that does not exist** — covered by AC-05 and AC-06. The prompt forbids
  inventing paths (`server/src/prompts/onboarding.system.md:16`) and nothing enforced it;
  `ExtractionStats.dropped_no_file` (`knowledge.ts:322`) is the precedent for verify-and-report.
- **Invalid mermaid in a diagram** — **no criterion, and that is acceptable**: `MermaidDiagram`
  gates on `mermaid.parse({ suppressErrors })` and renders `null` rather than throwing
  (`client/src/components/mermaid-diagram/MermaidDiagram.tsx:22-75`). The behavior already exists
  and this spec does not change it.
- **A reload during generation** — not covered. The request is blocking and leaves no job row, so a
  reload abandons it and no tour is written. See Open question 1.
- **A section with zero links, or a very long body** — not covered; see Open question 8.
- **Two writes in one generation** (the tour row and any stats it carries) — `server/` has one
  `.transaction(` call today and several multi-write sequences are non-atomic. This spec requires
  the tour to be one document in one row, so there is a single write and no partial state to
  specify. A design that splits it into two writes is required to state the partial-failure
  behavior first.

## Non-functional requirements

- **AC-29** — The system shall render every user-facing string of the tour from the `onboarding`
  next-intl namespace, with no inline literals. New keys are required for: the five section titles
  (one per `kind` in AC-01), the three degradation banners (AC-08, AC-10, AC-11), the staleness
  banner (AC-14), the hotness note (AC-13), the dropped-links note (AC-06), the empty state body
  (AC-22), the error-state body and retry action (AC-23), and the accessible name of a file link
  (AC-20).
- **AC-30** — The system shall give every icon-only control in the tour — including a section
  collapse control — an accessible name.
- **AC-31** — WHEN a regeneration completes, the system shall announce the outcome through a
  polite live region.
- **AC-32** — The system shall expose the tour's sections, its banners and its generate/regenerate
  actions with a queryable role and accessible name, so that a test can find them without matching
  display text.

Performance is stated as shape rather than as a threshold — AC-02 (exactly one model call) and
AC-03 (built from precomputed facts) — because this repository has no p95 target, no bundle budget
and no perf gate. A latency ceiling is Open question 4. Observability is covered by AC-02 and
AC-06; no list of events that must be logged exists in this repo, and none is invented here.

## Inputs and provenance

| Input | Source and owner | Absent or stale |
|---|---|---|
| Critical paths, top files by rank, repo map | repo-intel facade, in-process (`server/src/modules/repo-intel/service.ts:816`, `:792`, `:551`) | Array-returning methods return `[]` when degraded and never throw; the status is observable via `getIndexState`, which always answers |
| Index health | `getIndexState` — `edgesWritten`, `filesIndexed`, `degraded`, `degradedReason` (`server/src/modules/repo-intel/types.ts:27-57`) | `status` means "nothing threw", not "the data is there" (`server/insights.md:14`); AC-08 branches on the counter, never on `status` |
| Endpoint and cron facts | `file_facts`, precomputed by the indexer | Absent facts render as an absent claim, never as "none" |
| Stack and scripts | The repository's package manifest, read through the git port (path-escape guard at `server/src/adapters/git/simple-git.ts:140`) | The indexer persists no file tree beyond `symbols.path` and parses no `.json`, so this is the only source |
| The model call | `completeStructured`, which reports `tokensIn`, `tokensOut` and `costUsd` per call | AC-11 covers failure after retries |
| Model choice | `settings` table, `feature_models.onboarding`; registry default `openrouter` / `deepseek/deepseek-v4-flash` (`server/src/vendor/shared/contracts/platform.ts:43-50`, mirrored in `client/src/lib/feature-models.ts`) | Falls back to the registry default. Which module reads the row is the planner's call — `no-cross-module` forbids importing `modules/settings/feature-models.ts` (`server/insights.md:65`, `:75`) |
| Provider key presence | `GET /settings/secrets-status` (`server/src/modules/settings/routes.ts:39`) | AC-10 |
| Persisted tour | `onboarding.repo_id` (PK), `json`, `generated_at` (`server/src/db/schema/context.ts:120-126`) | AC-16 for documents predating a field |
| GitHub link base | `repos.owner` / `repos.name`. There is no URL or host column; import accepts github.com only (`GITHUB_URL_REGEX`, `server/src/modules/repos/constants.ts:18`) | Sound for every repository that can exist today; Open question 6 records the assumption |
| The API → client contract | `Onboarding` in `@devdigest/shared`. **The client does not validate at runtime** — the package is imported into `client/` as types only and a runtime import breaks the Next build (`invariants.md:26`). AC-18 exists because of this | Criteria in this spec are written against the **server** copy, `server/src/vendor/shared/contracts/knowledge.ts:28-47`; the `Onboarding*` block is byte-identical in the client copy today |

## Untrusted inputs

| Input | Rule |
|---|---|
| Repository file contents and excerpts sent to the model | Data, never instructions. The prompt already wraps them in `<untrusted>` and states the rule (`server/src/prompts/onboarding.system.md:11-12`); AC-28 makes it a requirement rather than prompt text |
| The repository's package manifest | Data. AC-04 reads names and scripts from it; nothing in it is executed, and nothing in it selects a code path |
| Model output — `title`, `body`, `diagram`, `links` | Untrusted and unverified. `title` is ignored for display (AC-17), `links` are verified against the indexed file set and dropped when unknown (AC-05), `body` renders as markdown with no HTML or script executed (AC-28), `diagram` renders only on `architecture` (AC-19) and only if mermaid parses it |
| A `kind` the client does not recognise | Arrives silently — there is no runtime validation on the client. Not rendered (AC-18) |
| The repository owner/name used to build a file URL | Constrained at import to github.com; the URL is built from stored columns and the stored sha, never from a model-supplied host |

## Open questions

1. **Reload during generation.** The blocking request leaves no job row, so a refresh abandons it
   and nothing resumes it. Answerable by the user. Blocks no criterion here — the tour is simply
   not written — but it decides whether a later spec needs job-backed generation.
2. **Wording of the three degradation banners, the staleness banner, the hotness note and the empty
   state.** Answerable by the user. Proposed default: the `repoNotFound.{title, body, cta}` shape
   already used in `client/messages/en/common.json`. Blocks the i18n *values*, not the keys or the
   criteria.
3. **A WCAG conformance level.** No repo convention exists. Answerable by the user. Proposed
   default: adopt none, and require only AC-30 to AC-32. Blocks nothing.
4. **A latency ceiling for the blocking generation request.** No budget exists anywhere in this
   repo. Answerable by the user. Proposed default: none; rely on AC-02 and AC-03. Blocks nothing.
5. **Relative-time phrasing** ("generated 3 days ago"). Only `en` exists and there is no date-format
   convention. Answerable by the user. Proposed default: reuse whatever the PR list already does.
   Blocks one i18n key.
6. **Non-GitHub repositories.** The file link assumes `github.com` because import accepts nothing
   else today. Answerable by the user, and only if a non-GitHub source is ever added. Blocks
   nothing now; recorded so the assumption is not invisible later.
7. **What the tour contains for a repository the indexer found zero supported files in.** AC-09
   settles that this is not a degraded index; it does not settle whether generation proceeds on the
   manifest alone, or the view shows a distinct "nothing indexable here" state. Answerable by the
   user. Blocks the content of that state, not AC-09.
8. **A section with zero links, or a very long body.** No design exists for either — whether an
   empty `links` array renders as an absent block, and whether a long `body` is truncated or
   collapsed. Answerable by the user. Blocks a display detail, no criterion.
