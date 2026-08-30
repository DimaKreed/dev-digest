# Eval Pipeline — why it is built this way

Implements [SPEC-04](../../specs/04-eval-pipeline.md). This file is the *why*; the spec is the
*what*, and `server/src/modules/eval/` is the *how*.

## The one decision everything else follows from: no judge model

The lab harness for the same experiment used an LLM judge, and it had to — its expectation was
"the reviewer explained the reason", which is not a substring match. Here the expectation is a
`file:line`, so a match is `a.file === e.file && ranges overlap`. Fifteen lines of arithmetic.

That is not merely cheaper. A judge model is **itself a variable**. With one in the loop, a
precision that fell two points has three possible causes — the reviewer changed, the judge
changed, or the judge sampled differently today — and the whole point of a regression harness is
that there is exactly one. `scoring.ts` therefore imports nothing but the contract types, and
`verify:l06` asserts that statically rather than trusting a test to have taken every path.

## What "precision" means here, and why it is not the textbook one

The textbook formula is `TP / (TP + FP)`, which requires knowing that every finding outside the
expectation set is wrong. It is not. A case is seeded from **one** accepted finding on a real
diff, and that diff contains more than the one thing somebody happened to click accept on.
Counting the extras as false positives would punish an agent for finding a second real bug — the
metric would reward silence.

So a false positive is defined narrowly and honestly: **a finding at a location a `must_not_flag`
case forbids**. Precision is then literally "the share of produced findings that are not noise",
and only a dismissed finding can create noise. This is what makes the accept/dismiss history a
dataset with two usable halves instead of one: accepted findings move recall, dismissed findings
move precision, and neither can move the other.

The consequence to be aware of: a set with no `must_not_flag` cases has a precision that is
permanently 1. That is correct — nothing in that set can say what noise looks like — and it is why
the seeded set ships four negative cases alongside six positive ones.

## Micro-averaging, not a mean of means

`aggregateMetrics` sums the counts and divides once. A macro average over cases would weight a
case with one expectation the same as a case with six, so **adding a small case could move recall
with the agent unchanged**. The batch number has to mean "of every expectation in the set, this
fraction was found", or the trend line is measuring the set instead of the agent.

## A batch is rows sharing a `batch_id`, not a table

One run of the set writes N rows into `eval_runs`, all carrying the same `batch_id`, and every
batch-level number is recomputed from their `counts` on read (`groupBatches`). There is no
`eval_batches` table on purpose: a materialised summary is a second place for `recall` to be
defined, and the first time someone deletes a case row the two disagree with no way to tell which
is right. The read is a group-by over tens of rows.

`ran_at` for a batch is its **newest** row, not its first: cases run several at a time and land
out of order, so no single row is "the batch" — but the last one to land is when it finished.

One case is capped at `EVAL_CASE_TIMEOUT_MS` (90 s) of wall clock, retries included, and a case
that trips it lands as an `error` row like any other case-level failure. The cap has to live in the
eval service rather than in the provider call: the OpenRouter provider runs three reprompt attempts
over an SDK client configured `timeout: 90_000, maxRetries: 2`, so bounding the request bounds one
attempt out of nine and leaves the case free to run for 13.5 minutes.

That same group-by is what makes a **running** batch readable for free. `POST /agents/:id/eval-runs`
and `POST /eval-cases/:id/run` answer `202` with the batch in a `running` state and execute the
cases in the background; the client polls `GET /eval/batches/:id` until `status` is `done`. Progress
needs no new storage — a case persists its own row the moment it finishes, so `cases_done` is a
count of rows and each case's result is readable as soon as it lands, rather than all of them
changing at once two minutes later.

The only thing held in memory is `EvalService.active`: what the batch set out to run, so
`cases_total` and `running` have an answer before the first row exists. It is deliberately not a
column, for the reason above — a batch cannot outlive its process, so a persisted `running` would
be a lie after every restart, with nothing left running to clear it. A batch read back from the
database is therefore always `done`.

## Why every row snapshots the prompt, the model and the version

`agent_versions` already stores the config, so the snapshot on `eval_runs` is duplication. It is
deliberate, and it is the same reasoning as `pr_brief.head_sha`: the compare view has to keep
working after the agent has been edited a third time, and after a version row has been pruned. A
run that cannot say what produced it is not evidence of anything.

It is also what makes the prompt diff possible at all — the modal diffs `from.system_prompt`
against `to.system_prompt`, two strings that were true at those two moments.

## Errors are not zeros

A case whose model call fails is persisted with `error` set, `pass: null`, and no `counts`. It is
excluded from every numerator **and** every denominator, and reported separately as
`batch.errors`. Writing `pass: false` there would be the single most damaging shortcut available:
a provider timeout would read as the agent getting the answer wrong, and the person reading the
dashboard would go and edit a prompt that was fine.

The same reasoning applies to cost: a batch where any case failed to report one has `cost_usd:
null`, because summing the rest prints a number smaller than what was spent.

## Inputs are frozen at creation, and a run never reads a pull request

`input_diff` is written once — from the `pr_files.patch` stored at the moment of the click — and
read on every run thereafter. The service has no path to the pull request at all, which is
asserted with a tripwire port in `eval-service.test.ts`. This is what "comparable" means: two runs
months apart see byte-identical input, so the only thing that can have moved is the agent.

The cost of that choice is that a case does not follow the file as it evolves. That is the right
trade — a moving input makes a moving metric meaningless — but it means a case can go stale, and
the fix is to create a new case rather than to make the old one chase head.

The related edge: a finding whose file has no stored `patch` cannot be frozen, so seeding is
rejected with a 422 that says so. Storing an empty diff would produce a case that fails on every
run for a reason nothing in the UI explains.

## Why the strategy is pinned instead of taken from the agent

`EVAL_STRATEGY` is `single-pass` for every eval run, even for an agent configured `map-reduce`. A
case's diff is one small file, so `auto` would choose single-pass anyway — pinning removes one
more way for two batches to stop being comparable, at no behavioural cost. Everything that
actually decides the outcome (the prompt, the skills, the gate, grounding, the scope filter) is
the agent's own.

## Citation accuracy counts the deferred as kept

`groundedKept` is `review.findings.length + deferred.length`, not just the active set. Being
deferred by the intent-layer scope filter is not a grounding failure — the citation gate passed
that finding — and counting it as one would make the number fall for a finding that was cited
correctly. The total is that plus what grounding actually dropped.

## Expected vs actual is rendered, never re-derived

`actual_output` stores `missed` and `violations` alongside the findings, and the case editor
renders them. The alternative — shipping the findings and the expectations to the browser and
matching them there — needs a second implementation of "same file, overlapping lines". Two
implementations of a rule drift, and the drift here would be a case shown as green next to a
recall of 0, which destroys trust in every other number on the page. `verify:l06` greps the view
for the shapes of that rule to keep it from creeping back in.

The colours invert per polarity, which is worth knowing before reading the panel: in a `must_find`
case a produced finding is good, and in a `must_not_flag` case a produced finding at the forbidden
location is the failure. Before the first run nothing is marked either way — an unrun case renders
neutral rather than green, because green would claim a result nobody measured.

## The click opens an editor; only Save writes

`POST /findings/:id/eval-case` still exists and still does the whole thing in one call — that is
what a script or an MCP tool wants. The UI does not use it. It reads a draft, and the draft is a
GET precisely so that opening a dialog cannot leave a case behind when the user closes it.

`previewCase` builds a synthetic `EvalCaseRow` with an empty id and hands it to the same `runOne`
a saved case goes through, then the same `scoreCase`. That sharing is the requirement, not an
implementation convenience: a preview that measured differently from the case it previews would be
worse than no preview, because it would be believed. `verify:l06` asserts the preview path touches
no repository method.

The returned row carries empty `id` and `case_id`. They are empty because there is nothing to
address — not as a placeholder to be filled in later — and the editor keys off that to label the
result "dry run · not saved".

## Runbook: the prompt-ablation experiment

This is the experiment the harness exists to make possible — does the system prompt actually do
anything, and can the numbers show it? Everything it needs is seeded: PR **#485** and the agent
**"Security Reviewer (control)"**, both from `pnpm db:seed`.

### What is set up, and why that way

**The agent.** `Security Reviewer (control)` carries the same prompt as the built-in Security
Reviewer and **no linked skills**. Both halves matter. It is a separate agent so the built-in one
and its ten seeded cases stay untouched. It has no skills because skills are rendered into the
prompt as their own section, independent of `systemPrompt` — leave `secret-leakage-gate` attached
and it keeps telling the ablated agent to hunt for secrets, holding recall up and blunting the
very thing you are measuring. The control agent carries exactly one variable, so it carries no
skills. It is seeded **disabled**, which keeps it out of "Run all" while leaving it one click away
in the Run Review dropdown (running an agent by id does not check the flag).

**The pull request.** #485 is two-sided on purpose, because the halves move different metrics:

- Four real defects — a swallowed signature verification, an authorization guard replaced by a
  TODO on a DELETE route, a callback URL from the request body reaching `fetch`, and one hardcoded
  `whsec_live_` secret. Three of them need control flow followed, not a pattern matched; the secret
  is the stable anchor that keeps a collapsed run distinguishable from a merely worse one.
- Four benign changes — a `var`→`const` refactor, an env rename with the default preserved, a
  `whsec_test_` placeholder in a fixture, an added passing test. Every one is something
  `SECURITY_REVIEWER_PROMPT` forbids reporting by name. Strip the prompt and the prohibitions go
  with it, so the noise lands exactly there.

**The ablated prompt.** `MINIMAL_REVIEWER_PROMPT` in `seed-prompts.ts` — the single sentence
`Review the diff.` Not an empty string: `PUT /agents/:id` requires a non-empty `system_prompt`, and
that guard is worth keeping. It is also not the interesting control — the engine appends
`INJECTION_GUARD`, sends the task line and the diff, and enforces the output schema at the provider
either way, so "empty" and "one bland sentence" arrive at the model as nearly the same thing. What
the sentence removes is the role, the OWASP scope, the severity definitions, "precision over
volume / no style nits", the conservative trifecta test, and "cite a line that exists in the diff".

### The order of the steps is load-bearing

The obvious order — build the case set, then ablate — cannot produce the negative half. A
`must_not_flag` case is seeded from a **dismissed** finding, and a well-prompted agent does not
flag the benign files at all, so there is nothing to dismiss. The noise has to be generated first,
while the prompt is still gone.

1. Select **acme/payments-api**, open PR **#485**, and run **Security Reviewer (control)** from the
   Run Review dropdown. This is the WITH-prompt pass.
2. On each real defect it found: **Accept**, then **Turn into eval case**. The editor opens over a
   draft — press **Run case** to dry-run it before saving, so a case whose expected line misses its
   own hunk is caught now rather than as a case that can never pass. **Save**.
3. Open the agent's **Config** tab, replace the system prompt with `Review the diff.`, Save. The
   version bumps to v2 and the old prompt is kept in `agent_versions`.
4. Run the review on #485 **again**. The noise appears — findings on the refactor, the rename, the
   fixture placeholder, the added test.
5. On each of those: **Dismiss**, then **Turn into eval case**. The polarity is read off the
   dismissal, so they arrive as `must_not_flag`. Save.
6. On the **Evals** tab, **Run all evals**. This batch is the ablated arm — it runs under v2.
7. Paste the real prompt back (copy it from `seed-prompts.ts`, or read v1 in the version history).
   Save; the version becomes v3.
8. **Run all evals** again, then open **Eval Dashboard → Security Reviewer (control)**, tick the
   two batches and press **Compare**. The modal shows each metric as old → new with a signed delta,
   and the two system prompts diffed line by line.

### Reading the result honestly

Expect recall to move less than precision. A blank-prompt model still finds a literal
`whsec_live_`; what it stops doing is *withholding* — so the clearest signal is precision falling
as the noise lands on the `must_not_flag` locations, and often citation accuracy falling too, since
"cite a line that exists in the diff" went away with the prompt.

Before reading any of it as an effect, run the SAME prompt twice and look at the spread. Measured
on the ten-case seeded set, two batches of an unchanged v1 agent differed by 17 points of recall
purely from sampling. A delta smaller than that noise floor is not evidence of anything, which is
why the dashboard's alert line ignores movement under half a point.

## Cross-module notes

- The module reaches into no sibling. `EvalAgentReads` and `EvalFindingReads` are structural
  ports over `AgentsRepository` and `ReviewRepository`, wired at the route composition seam —
  `no-cross-module` counts a type-only import as an edge.
- `unifiedDiffFor` in `service.ts` restates the patch-to-diff reconstruction from
  `modules/reviews/diff-loader.ts` for the same reason. It **must** stay equal to it: a case whose
  diff was assembled differently would ground its findings against different line numbers.
- The seeded case set derives its expectation line numbers from the hunk bodies
  (`seed-evals.ts` → `buildCase`) rather than having them typed in. A hand-typed line one off is
  invisible in review and shows up only as a case no agent can ever pass.
