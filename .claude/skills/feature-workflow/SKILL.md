---
name: feature-workflow
description: Runs a large change through the subagent chain — brainstorm, planner, implementer, test-writer, architecture-reviewer, security-reviewer, plan-verifier, doc-writer — with a fixed artifact hand-off between stages and a per-run trace under .devdigest/cache/runs/. Use at the start of any change that touches more than one package, more than one ring, a shared contract, or has a real design fork. Also use when the user invokes /feature-workflow or asks to run a feature through the agents, the workflow or the chain. Decides first whether the task earns the chain at all, and says plainly when it does not.
argument-hint: "[the change, in a sentence — or 'refactor: <boundary>']"
---

# Feature workflow

Twelve agents exist. This is the order they run in, what each one is handed, and what each one
leaves behind.

Every agent runs in its own context and sees none of this conversation — **only its final message
comes back**. That is why each stage writes an artifact to disk: the artifact, not the conversation,
is what the next stage reads.

## Stage 0 — does this earn the chain?

Run the chain when **any** of these is true:

- It touches **two or more packages** (`server/`, `client/`, `reviewer-core/`, `e2e/`).
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

| # | Stage | Agent | Model | Artifact | Verdict | Wall |
|---|---|---|---|---|---|---|
```

`.devdigest/` is gitignored, so nothing here enters the PR gate's scope fingerprint.

**What the trace can and cannot hold.** Model, artifact path, verdict and wall time are all
observable. **Per-agent token and dollar cost is not** — a subagent cannot see its own usage, and
nothing surfaces it to the caller. Record one session-level figure from `/cost` at the end, under
`## Cost`, and label it as session-level. Never write a per-agent breakdown; an invented one is
worse than an absent one.

## The chain

| # | Stage | Agent | Given | Leaves |
|---|---|---|---|---|
| 1 | Options | `brainstorm` | the request | `.devdigest/cache/options/<slug>.md` |
| 2 | Choice | *human* | the shortlist | the chosen option |
| 3 | Plan | `planner` | request + chosen option | `.devdigest/cache/plans/<slug>.md` |
| 4 | Approval | *human* | the plan digest | approval |
| 5a ∥ 5b | Build | `implementer` ∥ `test-writer` | the plan path | code, tests, two reports |
| 6a ∥ 6b ∥ 6c | Review | `architecture-reviewer` ∥ `security-reviewer` ∥ `plan-verifier` | diff scope (+ the plan for 6c) | three reports |
| 7 | Document | `doc-writer` | plan + reports + diff | docs |
| 8 | Close | *main session* | everything | `/engineering-insights`, then `/pr-self-review` |

**Stages 5 and 6 each go out in one message with several tool calls**, or they run in sequence and
you pay the wall time for nothing.

### Stage 1 — brainstorm

Skip it, and say you skipped it, when the approach is genuinely settled — a contract dictates the
shape, or an `insights.md` entry already decided it. `brainstorm` will return
`Blocked — no decision to brainstorm` on its own if you send it one of those; that is a correct
answer, not a failure, and it goes in the trace as `blocked`.

### Stage 2 — the human picks

The shortlist goes to the user with the option file path. **Do not pick for them and proceed.**
This is the one place a wrong turn is cheap to fix and expensive to leave, and the whole reason
stage 1 returns a shortlist rather than a winner.

### Stage 3 — planner

Hand it the request **and** the chosen option — the option's mechanism and its files-touched list,
not just its name. `planner` re-derives everything else itself.

A `No plan needed` back from `planner` after stage 0 said "run the chain" is a real signal: one of
the two gates read the task wrong. Say which you think it was rather than routing around it.

### Stage 4 — the human approves

`planner` returns a digest designed to be approved without opening the file. An empty
`Skills loaded while planning` in that digest is a reason to reject the plan — send it back rather
than passing a blind plan downstream.

### Stage 5 — implementer ∥ test-writer

Both get the **plan path**, not the plan text, and neither gets the other's output — that is the
point. `test-writer` runs in spec-first mode from the plan's *done-when* conditions, so its
assertions derive from the plan rather than from `implementer`'s code.

They write to different paths by construction (`test-writer` writes tests only). If both reports
name the same file, stop and reconcile before stage 6.

### Stage 6 — three reviewers, one diff

All three get the same diff scope; `plan-verifier` also gets the plan path. None of them gets the
implementer's report as evidence — `plan-verifier` treats it as a *claim*, and the other two never
see it. A reviewer that read the reasoning behind the change cannot review it fresh, which is the
entire reason these three are separate agents.

Expect and accept negative results. `no onion violations in this diff`, `no exploitable findings in
this diff`, and a traceability table that is all `met` are the normal outcome of a good plan
executed well. Do not send a reviewer back to find something.

**Any `CRITICAL` from 6a or 6b, or any `missing` from 6c, sends the work back to stage 5** with that
finding as the input — not to a new plan. Re-run stage 6 afterwards; a fix is a diff and gets
reviewed like one.

### Stage 7 — doc-writer

Runs when the change added a feature, a decision worth recording, or a measured result. Skip it for
an internal refactor with no external surface, and say you skipped it.

### Stage 8 — close in the main session

`/engineering-insights` first, then `/pr-self-review`. Both belong to the main session, not to an
agent: `engineering-insights` appends to files the agents deliberately cannot write, and
`pr-self-review` is the gate that blocks `gh pr create`.

Then append `## Cost` to the run file from `/cost`, session-level.

## The refactor variant

For a behavior-preserving change, stages 1 and 2 are unchanged and the middle differs:

| # | Stage | Agent | Leaves |
|---|---|---|---|
| 3 | Refactor plan | `refactor-planner` | `.devdigest/cache/plans/refactor-<slug>.md` |
| 5 | Build | `refactor-implementer` **alone** | characterization tests + the refactor |
| 6 | Review | `architecture-reviewer` ∥ `plan-verifier` | two reports |

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
- **Never skip stage 2 or stage 4.** Both are human gates. An agent chain that approves its own
  plan has no gate in it at all.
- **Never hand an agent another agent's context** — only the artifact path it is meant to read.
  Passing a summary instead defeats the fresh-context property the reviewers depend on.
- **Never re-run an agent to get a different answer.** A negative result is a result. If a report
  is wrong, say why with evidence and fix the input.
- **Append to the trace as each stage lands**, including `blocked` stages and skipped ones with a
  reason. A trace with gaps cannot be read afterwards.
- **Never fabricate per-agent cost.** Session-level from `/cost`, labelled as such.
- The chain never commits and never opens a PR. Stage 8 ends at `/pr-self-review`; publishing is
  the user's call.
