---
name: spec-creator
description: Produces one specification for a feature before any plan or code exists — interrogating the user across six question groups, analysing the design for gaps, uncovered corner cases, cross-module communication and UX problems, then handing a briefing to the spec-writer agent which emits the file. Use at the start of any feature whose behavior is not already fixed by a contract, and as stage 1 of feature-workflow. Also use when the user invokes /spec-creator or asks for a spec, a requirements document, acceptance criteria or EARS criteria. Owns the draft to approved status gate, and decides first whether the change earns a spec at all.
argument-hint: "[the feature, in a sentence — or a path/URL to the design]"
---

# Spec creator

A spec exists so that the tests can be derived from the **requirement** rather than from the
code. That is the one property the rest of the chain depends on, and it is the reason this stage
runs before `implementation-planner` rather than alongside it:

```
01 spec-creator            → spec.md
02 implementation-planner  → plan.md
03 implementer             → code
04 test-writer + architecture-reviewer   tests derive from spec.md, never from the code
05 plan-verifier           → traceability matrix: AC → work item → test → commit
```

Stage 04 is the whole point. Tests written from the implementation green against a wrong
implementation just as happily as against a right one.

**You run in the main session on purpose.** You are the only participant that can call
`AskUserQuestion` — a subagent cannot ask the user anything, it can only return a final message.
So the interrogation and the design reading happen here, and `spec-writer` gets a briefing file.

## Two files to read, and the skills not to load

| File | Read it in | What it gives you |
|---|---|---|
| [`references/repo-constraints.md`](references/repo-constraints.md) | pass 4, before the design critique | Facts that change what a spec may state — the diverged contract copies, no client-side validation, 422 before the handler, non-atomic multi-writes, ring-0 determinism, the closed output vocabulary, the flags that degrade silently |
| [`references/nfr-checklist.md`](references/nfr-checklist.md) | pass 5, on the Feedback and Edge-cases groups | Which of the five NFR areas this repo actually has a convention for (one: i18n) and which are open questions by default |

**Do not load the implementation skills to get at this material.** `onion-architecture` and
`frontend-ui-architecture` are 90% import-direction rules; `zod`, `fastify-best-practices`,
`next-best-practices`, `postgresql-table-design` and `react-best-practices` are framework and
DDL mechanics. Those belong to `implementation-planner`, and pulling them in here is how
implementation detail gets into a requirements document. The handful of genuinely behavioral
rules they contain is already extracted into the two files above, with sources.

`security` deserves its own warning: it is written for **React + Express + Mongoose + JWT**,
and this stack is **Fastify 5 + Drizzle/Postgres 16 + Next 15**. Its framing question — *can an
attacker control this value?* — is worth borrowing for `## Untrusted inputs`. Its numbers, its
middleware order and its checklists are for a system that does not exist here.

## Pass 1 — does this earn a spec?

Write a spec when **any** of these is true:

- The behavior is not already fixed by a contract under `vendor/shared/`.
- A user can observe it — a screen, a state, an endpoint response, a tool result.
- It has edge cases someone would argue about: empty, large, concurrent, partial, degraded.
- It crosses two or more packages, so the modules must agree on something in writing.

Otherwise: **no spec.** A copy change, a one-line fix, a rename, an internal refactor with no
observable change. Say which branch you took and why, in one line, before anything else. If the
answer is "no spec", stop here — that is a complete and correct outcome for this skill.

A refactor is the clean negative case: it preserves behavior by definition, so there is no new
requirement to state. Route it to `refactor-planner` instead and say so.

## Pass 2 — scope and number

Decide the owning directory:

| Scope | Directory |
|---|---|
| API, persistence, indexer behavior | `server/specs/` |
| Next studio behavior | `client/specs/` |
| Pure review engine behavior | `reviewer-core/specs/` |
| stdio MCP tool surface behavior | `mcp/specs/` |
| Behavior crossing two or more of the above | `specs/` (repo root) |

`e2e/specs/` is never a destination — it holds executable `.flow.json` flows. An end-to-end flow
requirement is cross-module and goes to the root `specs/`.

Then pick the number: the counter is **global across all five directories**. Take the highest
`NN` prefix anywhere and add one.

```bash
ls {,server/,client/,reviewer-core/,mcp/}specs/[0-9][0-9]-*.md 2>/dev/null || echo "no specs yet — start at 01"
```

Now read the owning module's `CLAUDE.md` and `insights.md`, plus the root `insights.md` if the
feature crosses modules, and **state the top 3 findings that bear on this task**. The root
`CLAUDE.md` session protocol requires this. "No prior findings bear on this" naming the files
read is a valid answer; skipping the step is not.

## Pass 3 — research gate

Launch `researcher` when a fact you need is missing, and **only** then. It has two modes — repo
research (where is X, how does Y flow, why is Z like this) and external research (docs, library
comparison, spec lookup) — and it is read-only.

Fan out to **several `researcher` instances in one message** when the unknowns are independent:
one on the existing server behavior, one on the client surface, one on an external standard. In
sequence they cost the same tokens and several times the wall clock.

Launch it for: how the current behavior actually works, what a library or protocol guarantees,
whether the repo already solves this somewhere. Do not launch it to answer a product question —
that is the user's to answer, and it goes in pass 5.

State what you launched and what you deliberately did not.

## Pass 4 — design analysis

Read [`references/repo-constraints.md`](references/repo-constraints.md) first. Several of the
four buckets below are only findable if you already know that the contract copies have
diverged, that the client does not validate what the API returns, and that loading, empty and
error states are not free framework behavior in this app.

Pull the design from whichever of these the user gave you:

- **Figma** — load the `/figma-use` skill guidance first, then `mcp__claude_ai_Figma__*`:
  `get_metadata` for the frame tree, `get_screenshot` to see it, `get_design_context` for the
  structure, `get_variable_defs` for tokens. Every colour in this repo is a `var(--token)`; a
  design carrying raw hex is a finding, not a spec decision.
- **Screenshots or images** — `Read` them directly.
- **The existing `client/` code** — what components and states already exist, and what the design
  implies that has no code behind it.

Then produce four buckets. This is a critique, not a transcription — a design handed over without
one of these buckets filled has almost certainly not been examined.

| Bucket | What you are looking for |
|---|---|
| **Gaps** | States with no design: loading, empty, error, partial, permission-denied, offline. Long strings, long lists, zero items, one item, thousands of items. |
| **Corner cases** | What two users doing this at once produces. What a half-finished operation leaves behind. What happens on refresh mid-flow. |
| **Module communication** | Which module produces each value on the screen, over which contract, and what the screen shows while that value is missing or stale. Cross the `vendor/shared/` duplication here — the canonical copy and the client copy have already diverged. |
| **UX improvements** | Where the flow costs the user a step, hides a state, or offers no way back. Proposals, explicitly marked as proposals. |

Show the buckets to the user before pass 5. Findings from them become the questions worth asking,
and several of them will be answered by the design itself.

## Pass 5 — the interrogation

Six groups. **This is not a six-round drill.**

| Group | What it settles |
|---|---|
| Data & loading | What data is needed, where it comes from, what happens on failure |
| Display & sorting | What is shown, in what order, in which states |
| Interactions | What actions the user has |
| State & persistence | What is stored, for how long, where |
| Feedback | How success, progress and failure are communicated |
| Edge cases | Empty states, large volumes, concurrency, partial data |

Work each group in this order:

1. **Answer it from the code and the design first.** A group the code closes unambiguously does
   not get asked — the answer is already binding.
2. **Report what closed and with what evidence** — `file:line`, or the design frame. The user
   needs to see what you did not ask about, otherwise a wrong inference passes silently.
3. **Ask only the unresolved part**, one `AskUserQuestion` round per surviving group, up to four
   questions in the round. Give every option a real consequence, and put your recommendation
   first, labelled.
4. **A question the user cannot answer yet is not a failure** — it goes to `## Open questions`
   with who can answer it and what it blocks.

**Before the Feedback and Edge-cases rounds, read**
[`references/nfr-checklist.md`](references/nfr-checklist.md). It is the guard against the
failure mode of this section: four of the five NFR areas — accessibility, performance,
observability, error copy — have **no convention in this repo**, so a confident number there is
fabrication that `test-writer` will assert and `plan-verifier` will verify. A missing
convention becomes an open question with a proposed default, never a criterion. Say which of
the five areas you reached which outcome for.

Run `brainstorm` here, and only here, when the **behavior** is a genuine fork — two designs a
user would experience differently. Not for a technical fork; that belongs to `implementation-planner`, and
`brainstorm` will return `Blocked — no decision to brainstorm` on its own if you send it one.
It writes `.devdigest/cache/options/<slug>.md` and returns a shortlist for the user to pick
from — do not pick for them.

Say which of the six groups you asked, which you closed from code, and whether you ran
`brainstorm`.

## Pass 6 — hand off, then the gate

Write the briefing to `.devdigest/cache/specs/<slug>-brief.md`. `.devdigest/` is gitignored, so
the briefing never enters the PR gate scope fingerprint.

````markdown
# Spec briefing — <goal>

## Scope decision
Directory: <path> · Number: NN · Why this directory: <one line>

## Prior findings that bear on this
- `<file>:<line>` — <the rule> — <how it constrains this spec>

## Research
What `researcher` was asked and what came back, with evidence. Or "none launched — <why>".

## Design analysis
### Gaps
### Corner cases
### Module communication
### UX improvements
Each item marked `confirmed` (the user settled it) or `open` (it did not).

## Resolved answers
### Data & loading
…one subhead per group. Each answer marked `from the user`, `from code (file:line)` or
`from the design (frame)`.

## Non-functional outcomes
One line per area — i18n, accessibility, performance, observability, error copy — each marked
`criterion` (a convention exists and is cited) or `open question` (none exists), with the
proposed default where it is open. An area the feature does not touch says so.

## Chosen option
From `brainstorm`, with the option file path. Or "no fork — <why>".

## Still open
Numbered, each with who can answer it and what it blocks.
````

Then spawn `spec-writer` with **the briefing path, not the briefing text**. It re-reads
everything else itself; handing it a summary defeats the fresh-context property.

When it returns:

1. Show the user its digest, including `## Not specified`.
2. Add the `## Index` line it named to the specs `README.md` — **replace** the
   `_Empty. Add a link here when you add a spec._` placeholder for the first spec in that
   directory, **append** for every one after. `e2e/specs/README.md` has no Index and must never
   be given one.
3. Add the spec to the owning module `CLAUDE.md` `## Docs` section. The Index line alone is
   half a registration.

## The status gate

| Transition | Who | Condition |
|---|---|---|
| — → `draft` | `spec-writer` | on creation, always |
| `draft` → `approved` | this skill | the user's **explicit** OK, after seeing the digest and the open questions |
| `approved` → `implemented` | this skill | the `plan-verifier` matrix has no `missing` row |

`draft → approved` is a human gate and there is no version of this skill that flips it on its
own judgment. It is the one place in the whole chain where a wrong requirement is still cheap to
fix; everything after it is code.

**The chain does not proceed on a `draft`.** `implementation-planner` planning against an
unapproved spec is planning against a guess that merely looks official.

Open questions do not block approval on their own — a spec can be approved with numbered open
questions, as long as none of them is load-bearing for a criterion. Say which ones you judge
load-bearing and let the user overrule you.

## EARS — what makes a criterion checkable

| Pattern | Shape |
|---|---|
| Ubiquitous | The system shall … |
| Event-driven | WHEN \<trigger\>, the system shall … |
| State-driven | WHILE \<state\>, the system shall … |
| Unwanted behavior | IF \<condition\>, THEN the system shall … |
| Optional feature | WHERE \<feature is enabled\>, the system shall … |

`shall` in all five, and it is not interchangeable with "should" or "must". Introduced by Mavin,
Wilkinson, Harwood and Novak at IEEE RE 09.

The test: **can you imagine a failing test for this sentence?** If not, it is not a criterion.
"Handles large repositories" fails. "WHEN a repository exceeds the indexing threshold, the system
shall build the overview from deterministic facts only, without reading every file in full"
passes.

Each criterion carries an `AC-NN` id, and those ids are cited by three downstream agents. Never
renumber a criterion in a later revision — supersede the spec instead.

## Rules

- **State the pass-1 decision out loud** before doing anything else.
- **Never write the spec file yourself.** `spec-writer` owns that one path, in its own context.
  You own the briefing, the Index line and the status.
- **Never flip `draft → approved` without an explicit OK.** Silence is not approval, and neither
  is the user answering your last question.
- **Never answer a product question on the user's behalf** and put it in the briefing as
  resolved. Mark it `open` and let the spec carry it.
- **Report what you closed from code, with evidence.** An unstated inference is the failure mode
  of this whole skill — it looks identical to a confirmed requirement in the finished spec.
- **No implementation in the spec or the briefing.** No ring placement, no file layout, no
  library choice. Those belong to `implementation-planner`, which reads this spec.
- **Never state an NFR this repo has no convention for as a criterion.** A WCAG level, a p95
  target, a required-log-events list and a bundle-size limit are all decisions nobody has made
  here. Propose them as defaults in `## Open questions`; adopting one is then a single word
  from the user.
- **Never run `researcher` or `brainstorm` unconditionally.** Both are real cost, and a spec for
  a small feature that spawned three agents is worse than one that spawned none.
- **Never re-run an agent to get a different answer.** A negative result is a result.
- One spec, one feature. A briefing that needs two `Spec ID`s is two runs of this skill.
- This skill never commits and never opens a PR.

## When this runs inside feature-workflow

It is stage 1, ahead of planning. `feature-workflow` hands the goal here and passes the
**approved** spec path to `implementation-planner`, `test-writer` and `plan-verifier`. Append the
row to `.devdigest/cache/runs/<slug>.md` as it completes, like every other stage — including
`no spec` with its reason.
