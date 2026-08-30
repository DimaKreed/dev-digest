# SPEC-04 — Eval Pipeline: regression harness for reviewer agents

Status: approved
Owner: L06
Scope: cross-module (`server/`, `client/`)

## Problem and the user

A reviewer agent is a prompt, a model and a set of linked skills. All three are edited by hand in
the studio, and today nothing tells the editor whether an edit made the agent better or worse. The
only feedback is running it on a pull request and reading the findings — which is slow, costs money
per run, and is not comparable between two edits because the input is never the same twice.

The user is the person editing an agent in the Skills Lab. They want to change a system prompt, a
model, or a linked skill, re-run a **fixed** input set, and read three numbers that moved.

The dataset already exists and does not need inventing: every accept/dismiss decision made on a
real finding in L01–L05 is a labelled example. An **accepted** finding says "at this file:line
there IS something to report". A **dismissed** finding says "at this file:line there is NOT".

## Goals

- Turn one real finding into one eval case with one click, in both polarities.
- Run an agent over its whole case set with the inputs held fixed, so two runs of different agent
  versions are comparable.
- Score the result **entirely in code** — no model call anywhere in scoring.
- Show recall / precision / citation accuracy per run, a history of runs, and a side-by-side
  comparison of two runs including the system prompt that produced each.

## Non-goals

- No LLM-as-judge. The lab harness needed one because "explained the reason" is not a substring
  match; here an expectation is a `file:line` and a match is arithmetic.
- No eval cases for skills. `eval_cases.owner_kind` already allows `'skill'`; only `'agent'` is
  produced or read by this feature.
- No CI lane that runs evals. The runs are manual, from the studio.
- No automatic promotion of a run to "the agent's version". Comparing is the deliverable.

## Data

`eval_cases` and `eval_runs` already exist (`server/src/db/schema/eval.ts`, migration `0000_init`).
This feature adds columns to both rather than new tables.

`eval_cases` gains:

| column | type | why |
|---|---|---|
| `expectation_kind` | `text NOT NULL DEFAULT 'must_find'` | `must_find` / `must_not_flag` — the polarity of the assertion |
| `source_finding_id` | `uuid` (no FK) | provenance of a case seeded from a finding; the finding may later be deleted, so no FK |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | stable list order |

`eval_runs` gains:

| column | type | why |
|---|---|---|
| `batch_id` | `uuid` | one run of the set is the rows sharing a `batch_id`; the per-case row stays the unit of storage |
| `agent_version` | `integer` | which `agents.version` produced the row |
| `system_prompt` | `text` | the prompt snapshot the compare view diffs; `agent_versions` also holds it, but a run must stay readable after the agent is edited |
| `model` | `text` | the model snapshot |
| `counts` | `jsonb` | the per-case scoring counts a batch aggregate is micro-averaged from |
| `error` | `text` | a case whose model call failed: recorded, never silently a zero |

`actual_output` holds `{ findings, missed, violations }` — not just the findings. `missed` are the
`must_find` expectations no finding matched and `violations` are the findings that landed on a
`must_not_flag` location, both as the scorer decided them. Persisting the verdict rather than
recomputing it on read is what keeps the expected-vs-actual view and the recall printed beside it
from ever disagreeing (AC-16).

`expected_output` stays `jsonb` and holds an array of expectations:
`{ file, start_line, end_line, severity?, category?, title? }`. Only `file`, `start_line`,
`end_line` participate in matching.

## Scoring — code only

A candidate finding **matches** an expectation when the file paths are equal and the line ranges
intersect.

Per case, over the agent's **grounded, in-scope** findings `A` and the case's expectations `E`:

- `must_find`: `tp = |{e in E : some a in A matches e}|`, `fn = |E| - tp`, `fp = 0`, `pass` iff `fn = 0`.
- `must_not_flag`: `fp = |{a in A : some e in E matches a}|`, `tp = fn = 0`, `pass` iff `fp = 0`.
- `grounded_kept` / `grounded_total` come from the engine's grounding gate for that case.

Per batch, micro-averaged over the case rows:

- `recall = sum(tp) / sum(tp + fn)`, and `1` when the denominator is 0 (no `must_find` case in the set).
- `precision = (sum(findings) - sum(fp)) / sum(findings)`, and `1` when the agent produced no
  findings at all. This is literally "the share of findings that are not noise", and only a
  `must_not_flag` expectation can make a finding noise.
- `citation_accuracy = sum(grounded_kept) / sum(grounded_total)`, and `1` when nothing was a candidate.
- `traces_passed / traces_total` = cases whose `pass` is true, over cases that ran.

A case whose run errored contributes `error`, counts nothing anywhere, and is not `pass`.

## Acceptance criteria (EARS)

- **AC-01** When the user asks to turn a finding into an eval case, the system shall build a case
  owned by the agent that produced the finding's review, seeded with the diff of that finding's
  file, and with one expectation at that finding's `file`, `start_line`, `end_line`.
  (Superseded in part by AC-18: the click opens an editor over that case rather than saving it.
  `POST /findings/:id/eval-case` still performs the whole flow in one call for non-UI callers.)
- **AC-02** Where the source finding carries `accepted_at`, the seeded case's `expectation_kind`
  shall be `must_find`; where it carries `dismissed_at`, it shall be `must_not_flag`; where it
  carries neither, the polarity shall default to `must_find` and remain editable before saving.
- **AC-03** When a finding's review has no `agent_id`, the system shall reject the seeding request
  with a 422 naming that the finding has no owning agent, and shall create no case.
- **AC-04** The system shall list every eval case of an agent on the Evals tab of the Agent Editor
  and shall show each case's expectation kind and last result.
- **AC-05** When the user runs the agent's whole set, the system shall execute one review per case
  over that case's stored input and persist one `eval_runs` row per case sharing one `batch_id`.
- **AC-21** When the user starts a run of the set or of a single case, the system shall accept it
  with `202` and the batch in a `running` state, execute the cases in the background, and shall not
  hold the request open for the duration of the run.
- **AC-22** While a batch is running, the system shall report how many of its cases have completed,
  and where a case has completed the system shall make that case's result readable before the rest
  of the batch has finished.
- **AC-24** The system shall bound one case at `EVAL_CASE_TIMEOUT_MS` of wall clock, retries
  included, and where a case exceeds it the system shall record that case with `error` set, exclude
  it from every metric, and continue the batch.
- **AC-23** Where the batch cannot be set up at all — an unresolvable provider, an agent with no
  cases — the system shall fail the starting request rather than accepting a batch that will never
  produce a row.
- **AC-06** The system shall compute `recall`, `precision` and `citation_accuracy` without any LLM
  call: the scoring module shall import no provider, and a run shall make exactly one model call
  per case, made by the review engine and not by scoring.
- **AC-07** Where a case's model call fails, the system shall persist that case's row with `error`
  set, shall exclude it from every metric numerator and denominator, and shall still return the
  batch for the remaining cases.
- **AC-08** The system shall record on every `eval_runs` row the `agent_version`, `system_prompt`
  and `model` in force when the row was written.
- **AC-09** The system shall list an agent's batches newest first, each with its metrics, its
  version and its cost.
- **AC-10** When the user selects exactly two batches and asks to compare, the system shall show
  each metric as old to new with a signed delta, and the two system prompts with the lines that
  differ marked.
- **AC-11** The Eval Dashboard shall appear in the left sidebar under Skills Lab, shall list every
  agent with its latest metrics, and shall list the most recent batches across all agents.
- **AC-12** Where an agent has never been run, the dashboard shall show it with no metrics and the
  words "never run" rather than zeros.
- **AC-13** The inputs of a case shall be fixed at creation: a run shall read `input_diff` and
  `input_meta` from the row and shall never re-fetch the pull request the case came from.
- **AC-14** The seeded workspace shall contain at least 8 eval cases for a built-in agent, of both
  polarities.
- **AC-15** The system shall show, for each case, the expected locations beside the findings the
  agent actually produced on its most recent run, marking which expectations went unmatched and
  which findings landed on a forbidden location.
- **AC-16** The system shall derive those marks from the values the scorer persisted with the run,
  and shall not re-implement the match rule in the client.
- **AC-17** Where a case has never run, the system shall say so in place of the actual output
  rather than rendering an empty result.
- **AC-18** When the user clicks "Turn into eval case", the system shall open an editor over a
  draft and shall persist nothing until the user saves.
- **AC-19** The system shall run a draft on demand before it is saved, using the same engine call
  and the same scorer a saved case gets, and shall persist neither the case nor the run.
- **AC-20** Where a draft could not be built — the finding has no owning agent, or its file has no
  stored patch — the system shall refuse to open the editor and shall name which.

## Why a draft, and not a saved case

The first implementation created the case on the click, which is what "one click" literally asks
for. It skipped the step the harness exists for. An expectation one line off its own diff hunk is
dropped by the citation-grounding gate on every run, so the case can never pass however good the
agent is — and nothing about it looks wrong in a list. The only way to find out is to run it.

So the click resolves a draft (`GET /findings/:id/eval-case/draft` — no write), the editor can run
that draft (`POST /agents/:id/eval-preview` — no write, same engine, same scorer), and `Save` is
the only thing that creates a row. The cost is one extra request and one extra decision; the thing
it buys is that no case enters the set without its author having seen what the agent actually
says about it.

## Edge cases

- A case whose `input_diff` parses to zero files can never pass. It errors with a message saying so
  rather than scoring 0 recall silently.
- A finding whose file has no `patch` stored on `pr_files` would seed a case with an empty diff; the
  create route rejects that with 422 rather than storing an unusable case.
- `eval_cases.owner_id` is a bare uuid with no FK (shipped schema). Cases of a deleted agent are
  unreachable rather than cascaded. Recorded, not repaired — the dashboard lists agents, not orphan
  cases.
- Two batches of the same agent version are comparable and their prompt diff is empty. That is a
  valid answer — it says the model, not the prompt, moved the numbers.

## Untrusted inputs

`input_diff` is repository content and reaches the model through the same delimiter-wrapped diff
section a pull-request review uses (`assemblePrompt`). Nothing in scoring interprets it. Case
`name` and `notes` are user text and are rendered as text, never as markup.

## Non-functional

- Cases run **four at a time** inside one batch (`EVAL_CONCURRENCY`), not sequentially. The cases
  of a batch are independent by construction (AC-13), and the measured ten-case set spent 111 s —
  exactly the sum of its ten model calls, 3.2 s to 24.3 s each, with no overhead between them. The
  bound is the provider's rate limit, not this process: a 429 costs a case its entire run, so a
  batch that trips the limit reports *less* than one that took longer.
- The earlier rule was sequential execution, on the grounds that a fan-out trades one
  comprehensible failure for N incomprehensible ones. That held while a batch was one synchronous
  HTTP call. It stopped holding once each case began persisting its own row with its own error
  text (AC-07): a failure is now one readable row, whether or not its neighbours were in flight.
- The batch runs **in the background** and is polled, because even at four at a time it is tens of
  seconds, and a request held open for that gives the browser a spinner that cannot be told apart
  from a dead run.
- One case is bounded at **90 s**, retries included. The provider nests its own three attempts
  inside an SDK configured with `timeout: 90_000, maxRetries: 2`, so an unbounded case can hold a
  slot for 13.5 minutes — measured, not theorised: a batch sat at 9/10 for over nine minutes on one
  case while the other nine finished in 56 s. The bound is applied at this layer rather than pushed
  down as a per-request timeout, because a per-request timeout bounds one attempt, not the case.
  The losing call is not cancelled — `reviewPullRequest` takes no `AbortSignal` — so its tokens are
  spent and its answer discarded; what is reclaimed immediately is the pool slot.
- A batch's `duration_ms` is the **sum** of its cases' model time, not the wall clock it took.
  Those were the same number under sequential execution and are not any more; the sum is what a
  cost- or budget-shaped question wants, and no surface renders it as elapsed time.
- `running` is **not persisted**. A batch cannot outlive the process executing it, so a status
  column would be stale on every restart with nothing left to clear it. Progress is a count of the
  rows that have landed, which is a fact the database already holds.
- The scoring module is pure and DB-free, so it is unit-tested with no Docker (`server-unit` lane).
