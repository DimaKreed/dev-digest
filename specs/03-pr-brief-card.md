# Spec: PR Brief — a generated merge-risk brief on the pull request Overview tab
Spec ID: SPEC-03
Status: implemented

## Problem and user

A reviewer opening a pull request in this studio is told what the change *is* — `IntentCard`
renders the derived intent, its scope and its confidence — and, on a different tab, what the
change *reaches*. Nobody is told what is **risky** about merging it, or which files to read
first. Those two questions are the reason a human opens a pull request at all, and the studio
answers neither.

The scaffolding for the answer is already in place and wired to nothing. The table `pr_brief`
exists (`server/src/db/schema/reviews.ts:88-93`) with zero reads and zero writes anywhere under
`server/src/modules/`. The contract `PrBrief` exists, composed of `Intent`, `BlastRadius`,
`Risks` and `PrHistory`, with a comment naming the column it round-trips through
(`server/src/vendor/shared/contracts/brief.ts:116-122`). A per-feature model id `risk_brief` is
registered (`server/src/vendor/shared/contracts/platform.ts:68-74`) — named for this feature and
currently *borrowed* by blast history-notes (`server/src/modules/blast/notes-service.ts:105-119`).
The i18n namespace `brief` is live and carries three keys nothing references: `block.risks`,
`noRisks` and `overlap` (`client/messages/en/brief.json:5,8,10`).

This is forward scaffolding, the pattern recorded at `insights.md:23-36`, not a stripped feature.
Its consequence for this spec is stated once here and applies throughout: **every deviation from
the existing `PrBrief` shape is a deliberate decision, recorded as such, never an oversight.**

The user is the reviewer on the PR detail page. Today `OverviewTab` renders `IntentCard` and the
pull request description and nothing else
(`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:29-45`),
and the Agent runs tab is the page's only findings surface (`client/insights.md:104-121`).

## Goals / Non-goals

**Goals**

- One brief per pull request, produced by **exactly one** structured model call, generated on
  explicit request and persisted.
- A brief that stands on its own: it carries its own risk level and works on a pull request that
  has never been reviewed by any agent.
- An honest brief: every input that was missing, degraded or dropped to fit the input cap is named
  to the reader, and every model claim not grounded in the assembled input is dropped visibly.
- A `PrBriefCard` on the Overview tab carrying the risk level, the summary, the risks and a
  clickable review-focus list that deep-links into the diff.
- Reuse that costs nothing: reopening the same PR state reads the stored brief and makes no model
  call.

**Non-goals**

- **A verdict, a findings count, a blocker count or a PR score on this card.** Those come from
  `agent_runs` and are already rendered by `VerdictBanner` on the Agent runs tab. The design's
  headline reads `Request changes · 6 findings · 2 blockers · PR SCORE 61`; this card shows the
  brief's own `risk_level` instead, deliberately, so that the brief does not require a review to
  have happened.
- **Risk rendering inside `IntentCard`.** The design places RISK AREAS there. `IntentCard` has no
  risk rendering and `pr_intent` has no risk column, so that placement would mean a second
  endpoint, a second loading state and a second regenerate button for one model call's output.
  `IntentCard` is **not modified by this spec**.
- **A Blast Radius card on Overview.** Blast is an entire separate tab today and stays one. It is
  an *input* to the brief here, nothing more.
- **A brief per commit (a "why timeline").** `pr_brief.pr_id` is a primary key; regeneration
  replaces.
- **Diff hunk bodies in the model input.** `pr_files.patch` exists
  (`server/src/db/schema/pulls.ts:36-45`) and is excluded on purpose — see AC-03.
- **Changing how grounding behaves elsewhere.** Review findings that do not map to real diff lines
  are dropped *silently* today (`server/CLAUDE.md:73-74`). AC-13 makes the drop visible **for this
  feature only**; it does not revisit the reviewer.
- Any contract change this spec requires is a **two-package change**: `@devdigest/shared` exists
  twice (`server/src/vendor/shared/`, `client/src/vendor/shared/`), the copies have already
  diverged, and the PR gate blocks a one-sided diff
  (`.claude/skills/pr-self-review/invariants.md:15`, slug `contract-copies-diverged`).
- **Owning the migration.** `pr_brief` as shipped carries only `pr_id` and `json`, so the reuse key
  of AC-15 needs a schema change. Migrations do not run on boot (`server/CLAUDE.md:64`), so this is
  a deployment step in the plan's path, named here rather than owned here.
- **Removing anything from the `brief` namespace.** It is protected scaffolding under the root
  `CLAUDE.md` § *Do not touch*. This spec **uses** it and adds keys; it removes none.
- A second locale. Only `en` exists in `client/messages/`.

## User stories

- As a reviewer opening a pull request, I want to be told its merge risk and why, so that I can
  decide how carefully to read it before reading any of it.
- As a reviewer, I want a short list of the places worth looking at, each opening the file at the
  line, so that I start at the hunk rather than at the top of a file.
- As a reviewer of a brief written earlier, I want to be told it describes a different commit or a
  different model, so that I do not act on a stale judgement.
- As a reviewer whose repository is half-indexed or whose issue tracker is unreachable, I want the
  brief to say what it could not see, so that I can weigh its confidence rather than trust it flat.
- As an operator, I want the brief's token usage and cost shown, so that I can see what a
  regeneration costs without reading server logs.

## Acceptance criteria (EARS)

### Generation and inputs

- **AC-01** — WHEN a brief generation is requested for a pull request, the system shall make
  **exactly one** structured model call, and shall report in the generation result the number of
  model calls made, the input tokens, the output tokens and the cost in USD.
- **AC-02** — The system shall assemble that call's input from the pull request's derived intent,
  a blast-radius summary, the diff stats (files changed, additions, deletions), the linked issue,
  and the repository's attached project-context documents — and from no other source.
- **AC-03** — The system shall not include any diff hunk body in the model input.
- **AC-04** — The system shall count the assembled model input with the server-side tokenizer
  before the call is made, and shall not send an input exceeding 8 000 tokens.
- **AC-05** — IF the assembled input exceeds 8 000 tokens, THEN the system shall drop inputs in the
  fixed order *project-context documents → the linked issue body → the tail of the changed-file
  list → blast downstream detail*, shall never drop the derived intent or the diff stats, and shall
  still make the call.
- **AC-06** — WHEN an input is dropped to satisfy AC-05, the system shall record that input, by
  name, in the stored brief's list of sources that did not fully reach the model.
- **AC-07** — IF an input source is absent, unreachable or degraded, THEN the system shall generate
  the brief from the sources that remain and shall record that source, by name and with the reason,
  in the same list; generation shall not be refused on that basis.
- **AC-08** — WHERE repository intelligence is disabled by flag, the system shall generate the
  brief without the blast-radius input and shall record the disabled flag as that source's reason,
  so the degradation is visible to the reader rather than silent
  (`server/CLAUDE.md:69-72` — the flag degrades silently today).
- **AC-09** — The system shall record, inside the stored brief document, the head sha the input was
  assembled from and the provider and model that produced it.
- **AC-10** — The system shall represent a brief as a `risk_level`, a short statement of *what* the
  change does, a short statement of *why* it is risky, a list of risks, and a list of review-focus
  entries — all four produced by the single call of AC-01.
- **AC-11** — The system shall represent every file reference inside a risk or a review-focus entry
  as a structured path together with an optional line number, never as a preformatted `path:line`
  string, so that a reference with no line is representable and each part is verifiable on its own.
  (Deviation from `Risk.file_refs: string[]`, `contracts/brief.ts:55`, recorded deliberately.)
- **AC-12** — IF a stored brief document lacks a field this spec introduces, THEN the system shall
  parse and display it without error, treating the field as absent. (Anything round-tripping
  through jsonb must tolerate an absent key — `insights.md:97-106`.)

### Grounding

- **AC-13** — WHEN a risk or review-focus entry carries a structured file reference whose path is
  not present in the input actually assembled for that call, the system shall drop that entry, and
  shall record the number of entries dropped in the stored brief and in the generation result, so
  the drop is observable rather than silent. (Precedent for verify-and-report:
  `server/src/modules/blast/notes-service.ts:90-99`.)

  *Narrowed 2026-08-28, after approval, at the stage-7 gate. The criterion originally read "a
  file, symbol or endpoint". A symbol or an endpoint appears only inside freeform prose —
  `risk.title`, `risk.explanation`, `focus.reason` — which carries no machine-readable field to
  verify against and never becomes a deep link, so the original wording was not checkable without
  a contract change adding `symbols[]` and `endpoints[]` to the model schema. The structured
  `{ path, line }` reference of AC-11 is the whole of what becomes clickable, and the stage-7
  security review confirmed that verifying it closes the reachable path from model output to a
  deep link. Ungrounded claims in prose remain possible and are an accepted property, recorded in
  § Untrusted inputs. Superseding this narrowing means a new spec, not an edit here.*

### Storage, reuse and staleness

- **AC-14** — WHEN a stored brief is read, the system shall return it without making any model call
  and without incurring any cost.
- **AC-15** — The system shall treat a stored brief as reusable only when its recorded head sha
  equals the pull request's current head **and** its recorded model equals the model currently
  resolved for this feature; on any other outcome it shall mark the brief stale. (The same reuse
  rule `pr_intent` already states, `server/src/db/schema/reviews.ts:77-79`.)
- **AC-16** — The system shall compute staleness server-side and return it as a field of the
  response, so that the client performs no sha or model comparison of its own.
  (`contracts/intent.ts:62-64` is the precedent.)
- **AC-17** — The system shall store at most one brief per pull request, keyed by that pull
  request; a regeneration shall replace it.
- **AC-18** — The system shall persist a brief as a **single** write of one document, so that no
  partial-brief state exists to observe. (`server/` has exactly one `.transaction(` call today, so
  a multi-write sequence is presumed non-atomic — `onion-architecture/SKILL.md:89-99`, rule H9.)
- **AC-19** — IF a generation fails at any point, THEN the system shall leave any previously stored
  brief unchanged, so the next attempt retries from a clean state.
- **AC-20** — IF the pull request's head advances between the input being assembled and the result
  being stored, THEN the stored brief shall record the head it was **built from**, not the head
  current at write time, and shall therefore report itself stale against the new head under AC-15.

### Concurrency, access and validation

- **AC-21** — IF a generation for the same pull request is already in flight, THEN the system shall
  not start a second model call and shall report the in-flight generation to the second caller.
  (The guard must be a check-and-add with no `await` between the two, as at
  `server/src/modules/reviews/service.ts:245-254`, whose docblock records that testing it after an
  `await` let two concurrent opens both pay.)
- **AC-22** — The system shall read and write a brief only for a pull request belonging to the
  requesting workspace, resolving that through the workspace-scoped pull lookup, and shall answer
  404 for any other pull request. (The scoped lookup is the authorization boundary, not a
  convenience — `server/src/modules/blast/service.ts:23-27`.)
- **AC-23** — IF a request carries a malformed pull request identifier, THEN the system shall
  reject it with **422 before the handler runs**. The identifier is the `pull_requests.id` uuid,
  never the GitHub pull request number (`server/src/modules/_shared/schemas.ts:11`).
- **AC-24** — IF no provider key is configured for the resolved brief model, THEN the generation
  request shall answer **503**, and the card shall state that a model key is required and present
  the regenerate action as unavailable. (Deliberate deviation: `Container.buildLlm` throws
  `ConfigError` today, `server/src/platform/container.ts:227-247`, and `ConfigError` maps to 500,
  `server/src/platform/errors.ts:36-40`. The app is advertised as booting with zero API keys, so a
  paid route must say so rather than look broken.)

### Display

- **AC-25** — The system shall render the brief card on the pull request Overview tab, above the
  existing intent card.
- **AC-26** — The brief card shall show the brief's own `risk_level` together with its *what* and
  *why*, and shall show no verdict, no findings count, no blocker count and no PR score.
- **AC-27** — The system shall render the brief's risks inside the brief card, and shall render no
  risk inside the intent card.
- **AC-28** — The system shall render the brief's review-focus entries inside the brief card as a
  list of activatable entries.
- **AC-29** — WHEN a review-focus entry is activated, the system shall open the diff tab at that
  entry's file, scrolled to its line, through the page's existing URL-carried deep link, so that a
  reload or a shared link reopens the same target.
- **AC-30** — WHERE a review-focus entry carries no line number, activating it shall open its file
  on the diff tab without a line target rather than being inert.
- **AC-31** — The system shall place the deep-link scroll target so that it is not obscured by the
  page's sticky header. (The page scroller is `<main overflow:auto>`, not the window, and the
  offset token already exists — `client/insights.md:162-174`.)
- **AC-32** — WHILE a generation is in flight, the system shall render a distinct in-progress state
  and shall prevent a second generation being triggered from the same view.
- **AC-33** — IF no brief exists for the pull request, THEN the system shall render an empty state
  carrying a title, a body explaining what generation does, and the generate call to action.
- **AC-34** — IF loading a brief fails, THEN the system shall render an error state carrying a
  title, a body naming the reason, and a retry action, distinguishable from the empty state of
  AC-33.
- **AC-35** — IF a generated brief carries no risk, or no review-focus entry, THEN the system shall
  render the corresponding "none flagged" statement rather than an empty block; both are valid
  results.
- **AC-36** — WHEN a stored brief is stale under AC-15, the system shall still display it, and
  shall display a stale badge together with a hint and a regenerate action, matching the existing
  `intentCard.stale` / `intentCard.staleHint` treatment.
- **AC-37** — The brief card shall name to the reader every source recorded under AC-06, AC-07 and
  AC-08, and the count of entries dropped under AC-13; none of them shall be swallowed.
- **AC-38** — The system shall regenerate a brief only on an explicit user action, and shall not
  regenerate one as a side effect of viewing, focusing or remounting the page. (A paid generation
  must be a mutation and never a query, because a query refires on focus and remount —
  `client/src/lib/hooks/blast.ts:24-30`.)
- **AC-39** — The brief card shall display the stored brief's input tokens, output tokens and cost;
  an unpriced call shall be displayed as unpriced rather than as costing zero.

## Edge cases

- **A pull request never reviewed by any agent** — covered: the brief depends on no `agent_runs`
  row (the Non-goals and AC-26 make that explicit), so it generates and renders normally.
- **Two reviewers pressing regenerate at once, or a second request arriving mid-flight** — covered
  by AC-21. Unlike SPEC-02's tour, which accepts two concurrent paid calls, this feature refuses
  the second: the precedent guard already exists in the intent service.
- **The head advancing during generation** — covered by AC-20 + AC-15: the brief is attributed to
  the head it described and immediately reads as stale.
- **The configured feature model changing after a brief was stored** — covered by AC-15: `head_sha`
  and `model` together are the reuse key, so a model change alone makes the stored brief stale.
- **A partial write** — cannot arise: AC-18 requires a single write of one document. A design that
  splits it into two writes must state the partial-failure behavior first.
- **Zero risks and zero review-focus entries** — covered by AC-35; the key `noRisks` already exists
  unused (`client/messages/en/brief.json:8`).
- **Very long lists of risks or review-focus entries** — **not covered by any criterion.** Open
  question 2. The input side is already bounded by AC-04/AC-05; the render side is not.
- **The API returning an unexpected shape** — no criterion, and that is acceptable here:
  `@devdigest/shared` is imported into `client/` as types only and a runtime import breaks the Next
  build (`invariants.md:26`), so there is no client-side validation anywhere in this app to be
  consistent with. AC-12 covers the server-side read of an older document.
- **A repository with no code index at all** — the blast input is simply one of the sources absent
  under AC-07. Generation is never refused for it; this deliberately differs from SPEC-02's AC-08,
  which refuses, because a brief without blast is still a brief.
- **`risk_brief` shared with blast history-notes** — a known coupling, not an edge case this spec
  resolves: both features resolve their model through the one `feature_models.risk_brief` setting
  (`server/src/modules/blast/notes-service.ts:105-119`), so changing one changes the other. Open
  question 7.

## Non-functional requirements

Worked in the five areas of `.claude/skills/spec-creator/references/nfr-checklist.md`.

- **Internationalisation — convention exists ⇒ criterion.**
  - **AC-40** — The system shall render every user-facing string this feature adds from the
    existing `brief` next-intl namespace, with no inline literal. New keys are required for: the
    risk-level labels, the *what* and *why* block labels, the review-focus block label, the
    degraded-source list heading (AC-37), the dropped-entries note (AC-13), the missing-model-key
    message (AC-24), the in-progress state (AC-32), the empty state's title, body and call to
    action (AC-33), the error state's title, body and retry (AC-34), the no-review-focus statement
    (AC-35 — `noRisks` already exists), and the usage and cost labels (AC-39). New keys shall be
    added in a sibling block to `intentCard`; **no existing key shall be removed**, because the
    namespace is protected scaffolding.
- **Accessibility — partial convention ⇒ two criteria only.** Limited to the two of the five rules
  in `.claude/skills/react-best-practices/SKILL.md:145-151` that this surface has. No conformance
  level is claimed — the user declined WCAG 2.2 AA; see open question 4.
  - **AC-41** — The brief card's icon-only regenerate control shall carry an accessible name.
  - **AC-42** — WHEN a generation completes, the system shall announce the outcome through a polite
    live region.
- **Performance — no budget exists in this repository ⇒ shape, not thresholds.** Stated as the
  verifiable shapes AC-01 (exactly one model call), AC-04 (a hard input cap counted in tokens) and
  AC-14 (a cached read makes no model call at all). Two facts that may be cited and are not targets:
  the Postgres pool is ~10, and `p-queue` governs fan-out to external services. A latency figure is
  open question 5.
- **Observability — criteria, because the user asked for them.** AC-01, AC-06, AC-07, AC-08, AC-13,
  AC-37 and AC-39. This closes a real gap rather than gold-plating it: blast history-notes discards
  `tokensIn`, `tokensOut` and `costUsd` entirely today
  (`server/src/modules/blast/notes-service.ts:77-101`), and intent records its usage only into the
  run trace, deliberately kept out of `agent_runs.cost_usd`
  (`server/src/modules/reviews/run-executor.ts:394-401`). No required-log-events list, redaction
  policy or correlation-id rule exists in this repo, and none is invented here. **Where the cost is
  recorded is open question 6, and it is potentially load-bearing for AC-39.**
- **Error copy and empty states — de facto pattern ⇒ criteria for structure, open question for
  wording.** AC-32, AC-33, AC-34 and AC-24 require the states explicitly, because this app has no
  `loading.tsx`, `error.tsx` or `not-found.tsx` and those states are therefore not free
  (`frontend-ui-architecture/SKILL.md:133-135`). The structure follows
  `common.repoNotFound.{title, body, cta}` and the shared `common.states` strings. Exact wording is
  open question 3.

## Inputs and provenance

| Input | Producer / owner | Absent or stale |
|---|---|---|
| Derived intent | **server**, `pr_intent` via `modules/reviews/intent.ts`, stored per `server/src/db/schema/reviews.ts:70-86` | Never dropped for the cap (AC-05); absent ⇒ recorded under AC-07 |
| Blast-radius summary | **server**, `modules/blast/service.ts:22-64` — computed on read over the code index, never stored | Degraded or index-less ⇒ AC-07; flag off ⇒ AC-08. A brief module may **not** import the blast service: `no-cross-module` blocks reaching a sibling module's helper or bare constant, including type-only imports (`server/insights.md:65-92`). The summary is obtained independently and this spec asserts nothing about the blast *tab's* response shape |
| Diff stats | **server**, columns `additions` / `deletions` / `files_count` on `pull_requests` (`server/src/db/schema/pulls.ts:22-24`) | Never dropped for the cap (AC-05) |
| Linked issue | **server**, extracted at `modules/reviews/intent.ts:72-95`, fetched at `:300-320`, confined to the PR's own repository as a confused-deputy guard | Unreachable ⇒ AC-07; body is the second thing dropped under AC-05 |
| Project-context documents | **server**, read live from the clone (`modules/context/`, SPEC-01) | First thing dropped under AC-05; absent ⇒ AC-07 |
| Diff hunk bodies | `pr_files.patch` (`server/src/db/schema/pulls.ts:36-45`) | **Excluded by AC-03.** Named here so the exclusion is visible rather than assumed |
| Token count | **server**, `container.tokenizer` (js-tiktoken), already used for pre-flight estimates at `modules/reviews/intent.ts:387` | It degrades permanently to a characters-based estimate when its encoder fails to load, which is why token figures elsewhere render as approximations (SPEC-01 AC-18). AC-04's cap is therefore enforced against that estimate |
| The model call | `completeStructured`, which reports `tokensIn`, `tokensOut` and `costUsd` per call. House pattern for a single structured call: `modules/blast/notes-service.ts:77-88` — `temperature: 0`, an explicit `timeoutMs` and `maxRetries`, and a **schema name that must be unique**, because `MockLLMProvider.structuredBySchema` and the trace reader both key on it (`modules/reviews/intent.ts:392-396`) | AC-19 on failure |
| Model choice | `settings` row `feature_models.risk_brief`, else the registry default `openai` / `gpt-4.1` (`server/src/vendor/shared/contracts/platform.ts:68-74`) | Currently shared with blast history-notes — open question 7. Which module reads the row is the planner's call; `no-cross-module` forbids importing `modules/settings/feature-models.ts` |
| Provider key presence | `GET /settings/secrets-status` (`server/src/modules/settings/routes.ts:39`) | AC-24 |
| Persisted brief | `pr_brief.pr_id` (PK) + `json` (`server/src/db/schema/reviews.ts:88-93`). The reuse key of AC-15 needs a **migration** — see Non-goals | AC-12 for documents predating a field |
| The API → client contract | `PrBrief` in `@devdigest/shared`, canonical at `server/src/vendor/shared/contracts/brief.ts:116-122`. Every criterion here is written against the **server** copy; the client copy must be edited alongside it | The client does not validate at runtime — types only |
| Client-side reads | **client**, through a hook in `src/lib/hooks/` over `src/lib/api.ts`; never `fetch` from a component (`client/CLAUDE.md:33-34`). Generation is a mutation, never a query (AC-38) | — |

## Untrusted inputs

| Input | Rule |
|---|---|
| The pull request title, description and changed-file paths | Data, never instructions. Wrapped as untrusted before entering the model input, the way `notes-service.ts:69-72` already wraps `pr-title` and `file-list` |
| The linked issue's title and body | Data. Attacker-controlled in the general case — anyone who can open an issue can write it — and confined to the PR's own repository at fetch time |
| Project-context document text | Repository content, therefore data, therefore wrapped as untrusted (SPEC-01 AC-22 and AC-38) |
| Model output — `risk_level`, *what*, *why*, risks, review-focus entries | Untrusted and unverified. File, symbol and endpoint references are verified against the assembled input and dropped when unknown (AC-13); text renders as text with no embedded HTML or script executed; a `risk_level` outside the values the contract declares shall not be rendered |
| A file path or line number from model output used to build a deep link | Never trusted as a target on its own — AC-13 requires the path to have been present in the input, and AC-29 builds the link from the page's own URL state rather than from a model-supplied URL |
| Diff hunk bodies | Not an untrusted input **to the model** here at all — AC-03 excludes them |

## Open questions

1. **Ordering within the risk list and the review-focus list.** Proposed default: preserve the
   model's own order. **User.** Blocks nothing — a display detail, load-bearing for no criterion.
2. **A cap on list length.** How many risks or review-focus entries are too many to render, and
   what happens past that. Proposed default: no cap, render all. **User.** Blocks nothing; the
   input side is already bounded by AC-04/AC-05.
3. **Exact error, empty, stale-banner and degraded-source copy.** The structure is fixed by
   `common.repoNotFound.{title, body, cta}` and the `common.states` strings; the words are not, and
   no tone guide exists. **User.** Blocks the i18n *values*, not the keys of AC-40 nor any
   criterion.
4. **Whether a WCAG conformance level applies.** The user declined 2.2 AA. Proposed default: none
   beyond AC-41 and AC-42. **User.** Blocks nothing.
5. **Whether a latency target applies to the blocking generation request.** No budget or
   measurement exists anywhere in this repository. Proposed default: none; rely on AC-01, AC-04 and
   AC-14. **User.** Blocks nothing.
6. **Whether the brief's cost joins `agent_runs.cost_usd` or is recorded separately.** The
   established precedent deliberately keeps ancillary call costs out of `agent_runs.cost_usd`
   (`server/src/modules/reviews/run-executor.ts:394-401`), because the classifier runs once per
   request while `{all:true}` opens N runs. **User, or `implementation-planner` as a persistence
   decision.** **Potentially load-bearing:** it decides where AC-39's figures are stored and read
   from, though not whether they are displayed.
7. **Whether `risk_brief` stays borrowed by blast history-notes.** That feature-model id was named
   for this feature and is currently used by another
   (`server/src/modules/blast/notes-service.ts:105-119`). Proposed default: leave the coupling and
   document it. **User.** Blocks no criterion, but two features sharing one configurable model
   setting means changing one changes the other.
8. **Whether the design's info icon beside the findings count becomes a provenance affordance**
   ("what went into this brief"). Proposed and not adopted, so no criterion requires it; AC-37
   already names the degraded sources in the card body. **User.** Blocks nothing.
