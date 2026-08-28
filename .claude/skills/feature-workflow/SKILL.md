---
name: feature-workflow
description: Runs a large change through the subagent chain — spec-creator, brainstorm, implementation-planner, implementer, test-writer, architecture-reviewer, security-reviewer, plan-verifier, doc-writer — with a fixed artifact hand-off between stages and a per-run trace under .devdigest/cache/runs/. Use at the start of any change that touches more than one package, more than one ring, a shared contract, or has a real design fork. Also use when the user invokes /feature-workflow or asks to run a feature through the agents, the workflow or the chain. Decides first whether the task earns the chain at all, and says plainly when it does not.
argument-hint: "[the change, in a sentence — or 'refactor: <boundary>']"
---

# Feature workflow

Thirteen agents exist. This is the order they run in, what each one is handed, and what each one
leaves behind.

Every agent runs in its own context and sees none of this conversation — **only its final message
comes back**. That is why each stage writes an artifact to disk: the artifact, not the conversation,
is what the next stage reads.

## Stage 0 — does this earn the chain?

Run the chain when **any** of these is true:

- It touches **two or more packages** (`server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp/`).
  All five count. `mcp/` is a *client* of the HTTP API rather than a sibling of `server/`, so it
  shares no source and has no cross-package CI edge — but a change spanning it and any other
  package still earns the chain, and the missing CI edge is a reason to run the reviewers, not
  to skip them. Never add that CI edge to compensate; root `CLAUDE.md` § *Cross-module wiring*
  says the isolation is deliberate.
- It touches **two or more onion rings** — a route and a repository, a component and an adapter.
- It changes a **contract** under `vendor/shared/`. Those are duplicated and already diverged;
  every such change is at minimum a two-package change.
- There is a **real design fork** — two or more approaches that land in different files.
- It is a **refactor with more than one caller** outside its own file.

Otherwise: **plain context, no subagents.** A single-file edit, a copy change, a one-line fix, a
question about the code — do it directly. The chain costs several fresh contexts that each re-read
`CLAUDE.md` and `insights.md` from scratch; spending that on a one-line change is pure overhead, and
it also makes a real run and a trivial one indistinguishable in the trace.

Say which branch you took and why, in one line, before doing anything else. If the answer is "plain
context", stop here — that is a complete and correct outcome for this skill.

## Stage 0.5 — open the run

Pick a kebab-case `<slug>` from the goal. Create `.devdigest/cache/runs/<slug>.md` with the header
below, then append one row per stage **as it completes** — not at the end, when the wall times are
already lost.

```markdown
# Run — <goal>

Started <date> · branch `<branch>`

| # | Stage | Agent | Model | Artifact | Verdict | Wall | Tokens |
|---|---|---|---|---|---|---|---|
```

`.devdigest/` is gitignored, so nothing here enters the PR gate's scope fingerprint.

**What the trace can and cannot hold.** Model, artifact path, verdict and wall time are all
observable. So is **per-agent cost** — an agent's completion notification carries
`subagent_tokens`, `tool_uses` and `duration_ms` — but only *once, live*: that notification is never
written to the session transcript, and the subagent's own transcript is empty. So the figures are
recoverable while the run is happening and **gone afterwards**, which is the same reason the rows
are appended as each stage lands rather than at the end. Add a `Tokens` column and fill it from the
notification as each stage completes; `—` for a human gate, and for an agent whose notification you
no longer have. Then one session-level figure from `/cost` at the end, under `## Cost`, labelled as
session-level. Never write a per-agent figure you did not read off a notification; an invented one
is worse than an absent one. `/workflow-retro` grades the finished run from these numbers.

## The chain

| # | Stage | Agent | Given | Leaves |
|---|---|---|---|---|
| 1 | Spec | `/spec-creator` → `spec-writer` | the request + any design | `<pkg>/specs/NN-*.md` or `specs/NN-*.md`, approved |
| 2 | Options | `brainstorm` | the request | `.devdigest/cache/options/<slug>.md` |
| 3 | Choice | *human* | the shortlist | the chosen option |
| 4 | Plan | `implementation-planner` | spec path + chosen option | `.devdigest/cache/plans/<slug>.md` |
| 5 | Approval | *human* | the plan digest | approval |
| 6a ∥ 6b | Build | `implementer` ∥ `test-writer` | the plan path ∥ **the spec path** | code, tests, two reports |
| 7a ∥ 7b ∥ 7c | Review | `architecture-reviewer` ∥ `security-reviewer` ∥ `plan-verifier` | diff scope (+ the plan **and the spec** for 7c) | three reports |
| 8 | Document | `doc-writer` | plan + reports + diff | docs |
| 9 | Close | *main session* | everything | `/engineering-insights`, then `/pr-self-review` |

This is the spec-driven order: the requirement is written and agreed **before** anything designs
against it, and it stays the reference all the way to stage 7c.

**Stages 6 and 7 each go out in one message with several tool calls**, or they run in sequence and
you pay the wall time for nothing.

### Stage 1 — the spec

Run `/spec-creator`. It decides for itself whether the change earns a spec, interrogates the user
across the six question groups, analyses any design for gaps and uncovered corner cases, and hands
`spec-writer` a briefing. The result is a spec file with `AC-NN` acceptance criteria in EARS form.

`No spec needed` back from it is a correct answer for a change with no observable new behavior — a
refactor being the clean case — and goes in the trace as `skipped` with its reason. The chain then
runs plan-first, exactly as it used to.

**The spec must reach `Status: approved` before stage 4.** That flip is a human gate owned by the
skill; `plan-verifier` returns `blocked` if it is handed a `draft`. Do not carry a `draft` forward
on the grounds that the user seemed happy.

### Stage 2 — brainstorm

Skip it, and say you skipped it, when the approach is genuinely settled — a contract dictates the
shape, or an `insights.md` entry already decided it. `brainstorm` will return
`Blocked — no decision to brainstorm` on its own if you send it one of those; that is a correct
answer, not a failure, and it goes in the trace as `blocked`.

### Stage 3 — the human picks

The shortlist goes to the user with the option file path. **Do not pick for them and proceed.**
This is the one place a wrong turn is cheap to fix and expensive to leave, and the whole reason
stage 2 returns a shortlist rather than a winner.

### Stage 4 — implementation-planner

Hand it the **spec path** and the chosen option — the option's mechanism and its files-touched list,
not just its name. `implementation-planner` re-derives everything else itself.

A `No plan needed` back from `implementation-planner` after stage 0 said "run the chain" is a real
signal: one of the two gates read the task wrong. Say which you think it was rather than routing
around it.

### Stage 5 — the human approves

`implementation-planner` returns a digest designed to be approved without opening the file. An empty
`Skills loaded while planning` in that digest is a reason to reject the plan — send it back rather
than passing a blind plan downstream.

**Three things go to the human here, in one `AskUserQuestion`, before anything is approved.** A
subagent cannot prompt anybody — only its final message comes back — so the digest carries these
as recommendations and *this stage* is where they become decisions:

1. **The plan itself.** Approve, or send it back with the reason.
2. **`Open questions`** — each unclear requirement the plan already assumed a default for. The
   plan is written under those defaults, so "go with the defaults" is a complete reply and costs
   nothing. Correcting one here is far cheaper than after stage 6.
3. **`Execution mode`** — the plan's multi-agent / single-agent recommendation. If the human picks
   **single-agent**, stages 6 and 7 collapse into one ordered main-session pass over the work items:
   no fresh-context reviewers, so say plainly that nothing graded the work independently, and record
   the choice in the trace as `single-agent` on the stage rows it replaced.

`Recommendations` in the digest are advisory. Accepting one changes the plan, so it goes back to
stage 4 rather than being patched into the plan by hand downstream.

### Stage 6 — implementer ∥ test-writer

Neither gets the other's output — that is the point. But they get **different inputs**, and this is
the pivot of the whole spec-driven order:

- `implementer` gets the **plan path**.
- `test-writer` gets the **spec path**, and runs spec-first from the `AC-NN` criteria.

Tests derived from the implementation green against a wrong implementation just as happily as
against a right one; tests derived from the plan are one remove closer but still describe a
*solution*. Only the spec states the *requirement*. `test-writer` returns a criteria-coverage
table and a `## Criteria not covered` section — an uncovered criterion there is a real gap and
goes to the human, not quietly past.

When stage 1 returned `No spec needed`, `test-writer` falls back to the plan's *done-when*
conditions. Say that you did.

They write to different paths by construction (`test-writer` writes tests only). If both reports
name the same file, stop and reconcile before stage 7.

### Stage 7 — three reviewers, one diff

All three get the same diff scope; `plan-verifier` also gets **both** the plan path and the spec
path, and builds one traceability row per acceptance criterion — `AC → work item → test → commit`.
A criterion whose `Work item` column reads `none` was agreed, planned around and never built; that
is the finding nothing else in this chain looks for. None of them gets the
implementer's report as evidence — `plan-verifier` treats it as a *claim*, and the other two never
see it. A reviewer that read the reasoning behind the change cannot review it fresh, which is the
entire reason these three are separate agents.

Expect and accept negative results. `no onion violations in this diff`, `no exploitable findings in
this diff`, and a traceability table that is all `met` are the normal outcome of a good plan
executed well. Do not send a reviewer back to find something.

**Any `CRITICAL` from 7a or 7b, or any `missing` from 7c, sends the work back to stage 6** with that
finding as the input — not to a new plan. Re-run stage 7 afterwards; a fix is a diff and gets
reviewed like one. A `missing` row whose `Work item` is `none` is the exception: that one goes back
to **stage 4**, because the gap is in the plan rather than in the code.

Once stage 7c returns with no `missing` row, flip the spec's `Status:` from `approved` to
`implemented`. That is the only condition under which it moves.

### Stage 8 — doc-writer

Runs when the change added a feature, a decision worth recording, or a measured result. Skip it for
an internal refactor with no external surface, and say you skipped it.

### Stage 9 — close in the main session

`/engineering-insights` first, then `/pr-self-review`. Both belong to the main session, not to an
agent: `engineering-insights` appends to files the agents deliberately cannot write, and
`pr-self-review` is the gate that blocks `gh pr create`.

Then append `## Cost` to the run file from `/cost`, session-level. `/workflow-retro` is available
to grade the run itself, but it is **manual** — run it only if the user asks.

## The refactor variant

For a behavior-preserving change, **stage 1 does not run at all** — a refactor preserves behavior
by definition, so there is no new requirement to specify, and `/spec-creator` will tell you so
itself. Stages 2 and 3 are unchanged, and the middle differs:

| # | Stage | Agent | Leaves |
|---|---|---|---|
| 4 | Refactor plan | `refactor-planner` | `.devdigest/cache/plans/refactor-<slug>.md` |
| 6 | Build | `refactor-implementer` **alone** | characterization tests + the refactor |
| 7 | Review | `architecture-reviewer` ∥ `plan-verifier` | two reports |

`test-writer` is **dropped** — `refactor-implementer` writes the characterization tests itself, and
two agents writing tests into the same lane collide. `security-reviewer` is optional here and runs
only if the refactor touched a route, a query, a secret or a rendering boundary.

The plan's `BLOCKED` count is the number to read first. Units that cannot be pinned by a test do not
get refactored, and a plan with several of them is telling you the boundary is wrong.

## Choosing agents outside the chain

Not every large task is a feature. Single agents, invoked directly:

| Need | Agent |
|---|---|
| A question about the repo, or about something outside it | `researcher` |
| Insights files have grown and nobody reads them | `insight-curator` |
| Docs for something already built | `doc-writer` |
| A security look at a diff with no plan behind it | `security-reviewer` |

## Rules

- **State the stage-0 decision out loud** before running anything.
- **Never skip stage 3 or stage 5, and never carry a `draft` spec past stage 1.** All three are
  human gates. An agent chain that approves its own spec and its own plan has no gate in it at
  all. Stage 5 decides three things — the plan, the open questions,
  and the execution mode — and picking the mode for the user is skipping the gate just as much as
  approving the plan for them is.
- **Never hand an agent another agent's context** — only the artifact path it is meant to read.
  Passing a summary instead defeats the fresh-context property the reviewers depend on.
- **Never re-run an agent to get a different answer.** A negative result is a result. If a report
  is wrong, say why with evidence and fix the input.
- **Append to the trace as each stage lands**, including `blocked` stages and skipped ones with a
  reason. A trace with gaps cannot be read afterwards.
- **Never fabricate per-agent cost.** Take it from the completion notification as the stage lands,
  or leave it `—`. Session-level cost from `/cost`, labelled as such.
- The chain never commits and never opens a PR. Stage 9 ends at `/pr-self-review`; publishing is
  the user's call.
