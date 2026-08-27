# Agents

Subagents run in their own context window with their own tool allowlist. They see none of the
calling conversation and **only their final message returns** — so every agent here re-reads the
repo's `CLAUDE.md` and `insights.md` itself, and every one has a fixed output contract.

This file is a map of the set. The rules live in each agent's own file; don't mirror them here.

## Catalog

| Agent | Role | Model | Writes files? | Returns |
|---|---|---|---|---|
| [researcher](researcher.md) | Answers a question — in the repo or outside it | `sonnet` | no | A fixed research report |
| [spec-writer](spec-writer.md) | Turns a briefing into one spec with EARS criteria | `opus` | one path only | Spec digest + the spec file |
| [brainstorm](brainstorm.md) | Generates and contrasts approaches before a plan exists | `opus` | one path only | Option set + shortlist |
| [implementation-planner](implementation-planner.md) | Reviews the requirements, then turns them into a plan | `opus` | one path only | Plan digest + the plan file |
| [implementer](implementer.md) | Executes an approved plan | `inherit` | yes | Implementation report |
| [test-writer](test-writer.md) | Writes tests — spec-first from the spec, or coverage top-up | `inherit` | tests only | Test report + criteria coverage |
| [architecture-reviewer](architecture-reviewer.md) | Audits a diff against the onion rule catalog | `opus` | no | Architecture review |
| [security-reviewer](security-reviewer.md) | Audits a diff for exploitable defects | `opus` | no | Security review |
| [plan-verifier](plan-verifier.md) | Checks finished code against the spec and the plan, item by item | `opus` | no | Verification + AC traceability |
| [doc-writer](doc-writer.md) | Turns a plan, a report or a diff into documentation | `inherit` | docs only | Documents + documentation report |
| [refactor-planner](refactor-planner.md) | Plans a behavior-preserving change, tests first | `opus` | one path only | Refactor plan + characterization inventory |
| [refactor-implementer](refactor-implementer.md) | Pins behavior, proves green, then restructures | `inherit` | yes | Refactor report + green-before proof |
| [insight-curator](insight-curator.md) | Reads all six `insights.md` at once and proposes | `sonnet` | no | Curation report |

The reserved slot is now filled. **Security review** was the last one open, and the argument that
kept it separate is the argument that produced five of these thirteen agents: a reviewer in a fresh
context sees the diff but not the reasoning that produced it, so no agent grades its own work.
`architecture-reviewer` owns layering, `security-reviewer` owns exploitability, `plan-verifier`
owns whether the plan was implemented — three narrow reviewers rather than one that would do all
three badly.

Two branches share the front of the chain and diverge after the plan. The **feature** branch adds
behavior; the **refactor** branch preserves it, which is a different enough problem to need its own
implementation planner and its own implementer — the refactor plan's first half is a characterization-test
inventory, and its implementer proves those tests green against the *unrefactored* code before it
touches anything. `insight-curator` sits outside both.

The chain itself is executable: [`/feature-workflow`](../skills/feature-workflow/SKILL.md) carries
the stage order, the artifact hand-offs, the human gates, and the rule for when a task is too small
to earn any of this.

## How they compose

```
spec-writer     what the feature must do, before anything designs how
                six question groups + design critique → EARS criteria with AC-NN ids
                → <pkg>/specs/NN-*.md · driven by /spec-creator, which does the asking
   ↓            (human approves: draft → approved)
researcher      (optional — external unknowns the plan would otherwise guess at)
   ↓
brainstorm      4-5 options on named axes, each with a confidence
                arbitrary order · shortlist, never a winner
                → .devdigest/cache/options/<slug>.md
   ↓            (human picks)
   ├─────────── feature ──────────┬─────────── refactor ───────────┐
   ↓                              │                                ↓
implementation-planner            │                     refactor-planner
                scope → route →   │                     boundary → callers → what is
                load skills →     │                     observable → inventory → steps
                requirements →    │                     → plans/refactor-<slug>.md
                design → conform  │
                reads skill-routes│
                + routing.md      │
   ↓            (approves · mode) │                                ↓
   ├──────────────────────────────┤                     refactor-implementer
   ↓                              ↓                     pin behavior → prove GREEN on the
test-writer                    implementer              unrefactored code → refactor under
tests from the spec's AC-NN    re-derives the same      green, one step at a time
criteria, before the code      route independently,     (test-writer is dropped here — it
(spec-first) or after it       loads the union,          writes its own characterization
(coverage top-up)              executes, verifies        tests, and two writers collide)
   └──────────────────────────────┤                                │
                                  ├────────────────────────────────┘
        ┌─────────────────────────┼─────────────────────────┐
        ↓                         ↓                         ↓
architecture-reviewer       plan-verifier            security-reviewer
onion catalog · two-pass    AC → work item →         five categories · refute each
recall/precision · every    test → commit, one row   candidate · taint path + exploit
finding carries a rule id   per criterion · four     or it is not a finding · ≥0.8
        │                   verdicts, never N/A      confidence gate
        └─────────────────────────┼─────────────────────────┘
                                  ↓
doc-writer      plan + report + diff → <pkg>/docs · <pkg>/specs · README · docs/experiments
                                  ↓
main session    /engineering-insights, then /pr-self-review

insight-curator  outside the chain — reads all six insights.md together and proposes
                 what to merge, reroute, promote or retire. Never writes one.
```

[`/feature-workflow`](../skills/feature-workflow/SKILL.md) is this diagram as an executable
procedure — the stage order, what each agent is handed, the three human gates, and the per-run trace
under `.devdigest/cache/runs/`. It also carries the gate that keeps the chain off small work: a
one-file change costs several fresh contexts here and buys nothing.

The two independent route derivations are the safety net: if `implementation-planner` skipped its
skill-loading step, the implementer's route won't match the plan's, and the mismatch lands in its `Deviations`.

Every reviewer's negative result is a real result. `no onion violations in this diff`, `no
exploitable findings in this diff` and an all-`met` traceability table are what a good plan executed
well looks like — sending a reviewer back to find something is how the reports stop being read.

---

## researcher

**Responsibility.** Two modes — *repo* (where is X, how does Y flow, why is Z like this) and
*external* (docs, specs, library comparison). Classifies the request, then runs the matching
workflow. Asks up to three questions with defaults when the request has no answerable question.

**Permissions.** `Read, Grep, Glob, Bash, WebSearch, WebFetch`. `Bash` is inspection only — git
history, `ls`, `cat`. Withheld: everything that writes, and delegation to other agents.

**In.** A concrete question, with the package or scope named if it matters.
**Out.** Report format A (repo) or B (external). Both carry a mandatory `Not found` section that
is never "N/A" — a silent gap is the failure the format exists to prevent.

---

## spec-writer

**Responsibility.** Write one specification file from a briefing, with every acceptance criterion
in one of the five EARS patterns and a stable `AC-NN` id. Never edits a spec; a spec that needs
replacing gets a new number and a `Supersedes:` line. Never answers a question the briefing left
open — that goes to `## Open questions`, because a confident invention here propagates into the
plan, the tests and the verification matrix before anyone notices.

**Why it is an agent and not just the skill.** The interrogation cannot happen in an agent —
`AskUserQuestion` is unavailable to a subagent, which can only return a final message. So the
asking, the Figma reading and the design critique live in
[`/spec-creator`](../skills/spec-creator/SKILL.md) in the main session, and only the *writing* is
delegated. That split also settles the tool question: the `tools:` allowlist in the validator holds
no `mcp__*` names, so an agent could not declare the Figma tools even if it wanted them.

**Permissions.** `Read, Grep, Glob, Write, Skill` · `model: opus` · no `skills:` key. No `Bash`
and **no `Edit`** — it creates one new file and cannot rewrite anything, which is what makes its
single write path checkable rather than merely stated. It is in the validator's `WRITE_SCOPED` set.

**One write path**, one of `specs/NN-name.md`, `server/specs/NN-name.md`,
`client/specs/NN-name.md`, `reviewer-core/specs/NN-name.md` or `mcp/specs/NN-name.md`. Never
`e2e/specs/` — that holds executable `.flow.json` flows and has no `## Index`. The `NN` counter is
**global across all five directories**, so `SPEC-07` identifies one spec repo-wide: the directory
carries the scope, the number carries the identity, and `Supersedes:` needs no qualification.

**In.** A briefing path under `.devdigest/cache/specs/`. Nothing else — it returns
`Blocked — no briefing supplied` rather than reconstructing one, because a reconstructed briefing
is a guess about what the user wanted.
**Out.** A digest carrying the spec path, the criterion count by pattern, the Index line the caller
must add, and a mandatory `## Not specified` section that is never "N/A".

**Why the ids matter.** `implementation-planner` cites `AC-NN` per work item, `test-writer` names
one per assertion, and `plan-verifier` builds one traceability row per criterion — `AC → work item
→ test → commit`. Renumbering a criterion breaks all three at once, which is why a revision
supersedes rather than edits.

---

## brainstorm

**Responsibility.** Generate options and contrast them; never choose, never design. Finds the
**axes** first — where the work lives, when it happens, what carries the state, how much is built
now — then places one option on each, because options generated by asking "what else could we do"
differ by wording rather than by structure. Returns a ranked shortlist, not a winner. Stops with
`Blocked — no decision to brainstorm` when the request has one obvious implementation.

**Permissions.** `Read, Grep, Glob, Bash, Skill, Write` · `model: opus` · no `skills:` key.

- `Write` is scoped by the body to **one path**: `.devdigest/cache/options/<slug>.md`, the same
  single-path discipline `implementation-planner` uses, and the same gitignored directory.
- No preloaded skills, deliberately. Placement rules would bias the set toward the placement those
  rules already prefer, which is the opposite of this agent's job. It loads a skill at runtime only
  when an option's *viability* turns on a rule.
- Withheld: `Edit`, `WebSearch`/`WebFetch` (that is `researcher`'s job — its report is an *input*
  here), `Agent`, `TodoWrite`, `PowerShell`.

**In.** A request with a genuine fork in it.
**Out.** `.devdigest/cache/options/<slug>.md` — constraints, axes, 4-5 options each with a named
axis, a three-sentence mechanism cap and a confidence, a comparison table with no empty cells, a
ranked shortlist, and a mandatory `## Discarded and why`. Plus a digest good enough to pick from
without opening the file.

Three body rules carry most of the weight. **Four or five options, never three** — below four the
set collapses toward the obvious one. **A confidence per option**, because a set of uniform 0.7s is
a set where that field was skipped. **Arbitrary order, stated as arbitrary, with a length cap** —
the first and the longest option get read as the best one, so ranking is confined to
`## Recommendation` where it can be argued with.

---

## implementation-planner

**Responsibility.** Produce a plan another agent can execute without guessing: right ring, right
package manager, right skills, right verification command, nothing silently skipped. It plans
**how**, never *why* — the plan points at its requirements source rather than restating it. Never
writes code. Stops with `No plan needed` when the change fits in one sentence and one file.

It also reviews the requirements it was handed. Pass 3 marks each decision *clear* or *unclear*,
where unclear means two reasonable implementers would touch **different files**, and gives every
unclear item a proposed default. The plan is then written **under those defaults** rather than
withheld: a subagent that stops on the first ambiguity has spent a whole fresh context and returned
nothing, while a wrong default is one cheap correction at the stage-4 gate. Recommendations are
held to the same evidence bar as findings elsewhere here — one that cannot name the rule,
`insights.md` entry or `file:line` behind it is an opinion and gets dropped.

**Permissions.** `Read, Grep, Glob, Bash, Skill, Write` · `model: opus` ·
`skills: onion-architecture, frontend-ui-architecture` preloaded.

- `Write` is scoped by the agent body to **one path**: `.devdigest/cache/plans/<slug>.md`. That
  directory is gitignored, which keeps the plan out of the PR gate's scope fingerprint.
- `Skill` is load-bearing: the two preloaded skills cover *placement*, and everything else is
  loaded at runtime from the route.
- Withheld: `Edit`, `WebSearch`/`WebFetch` (that is `researcher`'s job), `Agent` (no fan-out).

**In.** A request, plus the repo. Reads root + module `CLAUDE.md`, the matching `insights.md`,
`TESTING.md`, [`.claude/skill-routes.md`](../skill-routes.md) and
[`routing.md`](../skills/pr-self-review/routing.md) / `invariants.md`.

**Out.** `.devdigest/cache/plans/<slug>.md` — a requirements pointer and review, scope, prior
findings, routing, work items with a *done-when*, a conformance table, a wiring checklist,
verification commands, and an execution-mode recommendation. Plus a standalone digest as the final
message, so the plan can be approved without opening the file.

Two of those outputs are **questions, not conclusions**, and neither is the agent's to settle. A
subagent cannot prompt anybody — only its final message returns, and no agent here holds
`AskUserQuestion` — so `Open questions` and `Execution mode` travel in the digest as
recommendations carrying defaults, in the same shape `researcher` and `doc-writer` use, and
[`/feature-workflow`](../skills/feature-workflow/SKILL.md) § *Stage 4* is where the human turns them
into decisions. The execution-mode recommendation is derived from that skill's five stage-0 triggers
rather than from criteria of its own, so the two cannot drift apart.

---

## implementer

**Responsibility.** Execute the plan's work items in order, loading the skills that govern each
one before touching its files. Verifies that its own changes run. Does **not** judge architecture
or security — it hands the reviewers pointers, not verdicts. Returns `Blocked` rather than
improvising a plan.

**Permissions.** `Read, Write, Edit, Glob, Grep, Bash, PowerShell, Skill, TodoWrite` ·
`model: inherit`.

- `PowerShell` alongside `Bash` because Windows is a first-class dev box here — the PR gate itself
  is PowerShell-only.
- Withheld: `WebSearch`/`WebFetch` (missing information is a blocker to report, not something to
  improvise) and `Agent`.
- Never commits, never opens a PR, never edits any `insights.md`, never regenerates the
  dependency-cruiser baseline.

**In.** A plan path under `.devdigest/cache/plans/`, or the plan text inline.
**Out.** Code changes, plus an Implementation report: work items, routing and skills actually
loaded, changes per file, a verification table with verbatim failures, deviations, what is not
done, and pointers for the reviewers.

---

## test-writer

**Responsibility.** Two modes — *spec-first* (tests before the code, from the plan's *done-when*)
and *coverage top-up* (tests after it, against code that already exists). Picks the lane from
`TESTING.md` § *Suite map*, writes the tests, runs them. Every assertion names the source it was
derived from; one with no source outside the implementation is tagged `[behavior-locked]`, because
a test written after the code otherwise locks in what the code *does* rather than what it should.
Never edits production source to make a test pass — a failing test is a finding. Returns
`Blocked — no test target supplied` rather than picking a file that looked uncovered.

**Permissions.** `Read, Write, Edit, Glob, Grep, Bash, Skill, TodoWrite` · `model: inherit` ·
`skills: onion-architecture` preloaded.

- `Edit` so an existing suite gets extended instead of duplicated.
- `Bash` is narrowed by the agent body to the five suite runners plus inspection, each pinned to
  its directory — running pnpm in `reviewer-core/` or `e2e/` is destructive, not merely wrong.
- `react-testing-library` is deliberately **not** preloaded: it is the largest `SKILL.md` here and
  the one root `insights.md` flags as contradicting this repo, so it is loaded at runtime and the
  body's four overrides land *after* it rather than before it.
- Withheld: `WebSearch`/`WebFetch`, `PowerShell` (every documented runner is POSIX), `Agent`.

**In.** A plan path, or a named component, endpoint or behaviour.
**Out.** Test files, plus a Test report: mode, lanes and the skills each one loaded, a `Derived
from` per test that is never blank, a verification table with verbatim output, `Found but not
fixed`, and `Not covered`.

---

## architecture-reviewer

**Responsibility.** Audit a diff or a named file set in `server/` and `reviewer-core/` against the
onion rule catalog, in a context that never saw the reasoning behind the change. Two passes: pass 1
is recall — `pnpm arch` plus six grep probes, producing *candidates*; pass 2 is precision — re-open
each file and drop anything not inside a real hunk, not covered by a named rule id, or not fixable
by a concrete edit. `no onion violations in this diff` is a normal result. Returns
`Blocked — no review scope supplied`; never audits the whole repo.

**Permissions.** `Read, Grep, Glob, Bash, Skill` · `model: opus` ·
`skills: onion-architecture` preloaded.

- Read-only on purpose. `Write` and `Edit` are withheld so it *cannot* fix what it found — a
  reviewer that edits is grading its own work again, which is the split this slot exists for.
- `Bash` is allowlisted in the body: `pnpm arch`, `pnpm arch:all`, git inspection, `rg`, `ls`,
  `cat`. No redirects, no installs, no state-changing git.
- Withheld: `WebSearch`/`WebFetch` — the rule catalog is the only source of truth, and an external
  source is exactly how a finding with no rule id appears. Also `TodoWrite`, `PowerShell`, `Agent`.
- Never regenerates `.dependency-cruiser-known-violations.json`; the baseline only shrinks.

**In.** A scope — a base ref, a branch, or a named file list.
**Out.** Architecture review: verdict, the mechanical pre-pass table, findings as
`SEVERITY · rule-id · file:line · what to do instead` with the line quoted verbatim, plus
`Dropped in pass 2`, `Known debt touched by this diff`, `Not checked`, and pointers — never
verdicts — for the security reviewer.

---

## security-reviewer

**Responsibility.** Audit a diff for defects that can actually be exploited, in a context that
never saw the change being made. Pass 1 sweeps five fixed categories — input validation, authn/authz,
crypto & secrets, injection & code execution, data exposure — producing *candidates*. Pass 2 tries
to **kill** each one and promotes only what survives. `no exploitable findings in this diff` is the
normal result. Returns `Blocked — no review scope supplied`; never audits the whole repo.

**Permissions.** `Read, Grep, Glob, Bash, Skill` · `model: opus` · `skills: security` preloaded.

- Read-only, and mechanically enforced — `security-reviewer` is in the validator's `READONLY` set
  alongside `architecture-reviewer` and `plan-verifier`, so `Write` or `Edit` creeping back in is a
  `FAIL`, not a silent regression.
- The `security` preload is a **lens, not a source**. It is OWASP vocabulary; it also describes
  Express, MongoDB and JWT, none of which exist here. Root `insights.md` records that a skill in
  this repo has confidently described a codebase that does not exist, and the body says to grep for
  a symbol before any finding depends on it. `reviewer-core/insights.md` records the matching
  measurement — a skill that restates the agent's own prompt buys nothing but input tokens — which
  is why the body carries the *procedure* and the skill carries the *taxonomy*, with no overlap.
- Withheld: `Write`, `Edit`, `WebSearch`/`WebFetch` (a remembered CVE is not evidence, and an
  external source is how a finding with no taint path appears), `TodoWrite`, `PowerShell`, `Agent`.

**In.** A scope — a base ref, a branch, or a named file list.
**Out.** Security review: verdict, coverage, findings with the seven-field evidence contract, plus
`Dropped — below the confidence gate`, `Dropped in pass 2`, `Advisory`, `Known debt touched by this
diff`, `Not checked`, and pointers — never verdicts — for the architecture reviewer.

Four decisions define it. **No exploit scenario, no finding** — a taint path from attacker-controlled
source to sink, written out file by file, or it is dropped. **A confidence gate at 0.8**, because
precision and not recall is the limit for this kind of reviewer, and a false positive costs a human
the time to disprove it. **Severity is derived**, from a likelihood × impact table, into this repo's
contract vocabulary `CRITICAL | WARNING | SUGGESTION` — not the HIGH/MEDIUM/LOW an upstream security
prompt uses, because `pr-self-review` blocks on `CRITICAL` and the level is therefore a gate. And an
explicit **`## Do not flag`** list, which is longer than the categories it sweeps: the repo-specific
entries are the `INJECTION_GUARD` and `<untrusted>` wrapping in `reviewer-core/src/prompt.ts` — that
is the product's mitigation, not its hole — and the `## Do not touch` scaffolding.

It is also told not to trust the branch name, the commit message or a PR description as evidence.
Framing in that metadata shifts LLM security judgments in both directions, and this agent is
otherwise ideally positioned to be fooled by it.

---

## plan-verifier

**Responsibility.** Check finished code against a Development Plan, one item at a time, in a
context that never saw the implementation happen. Enumerates every checkable claim in the plan and
states the count *before* verifying, so a skipped item is visible rather than merely absent;
re-runs the plan's own verification commands instead of trusting the implementation report; and
closes with one row per item. Never reconstructs a plan from the diff — a plan inferred from the
code can only conclude the code is right. Returns `Blocked — no Development Plan supplied` or
`Blocked — no diff scope supplied`.

**Permissions.** `Read, Grep, Glob, Bash, Skill` · `model: opus` · **no `skills:` key at all** —
omitted rather than empty, since an empty sequence is undocumented for the loader.

- `Bash` does two things and nothing else: inspection, and every command from the plan's own
  `## Verification` section run verbatim in the named directory with the named package manager.
  Those commands are the only executable statement of the plan's acceptance criteria.
- `Skill` stays in `tools` for exactly one case: a *done-when* that names a rule, where the rule
  text has to be read to check the claim. Preloading a skill would hand it a corpus of general
  rules to reach for the moment an item got hard to verify — the substitution it must refuse.
- Withheld: `Write`, `Edit` (a verifier that can close a gap has no gap to report), `WebSearch`,
  `WebFetch`, `TodoWrite` (the traceability table *is* the list), `PowerShell`, `Agent`.

**In.** The plan **and** a diff scope; optionally the implementer's report, treated as a claim and
never as evidence.
**Out.** Plan verification: `Items extracted` with a count per bucket, a `Traceability` row per
item carrying the verbatim *done-when* and one of four verdicts — `met`, `partial`, `missing`,
`unverifiable` — the re-run commands, `Gaps`, `Optional — not gaps`, `Scope creep` and
`Unverifiable`. `N/A` is not a verdict and a blank cell is a defect in the report.

---

## doc-writer

**Responsibility.** Turn a plan, an implementation report or a diff into documentation, and route
each document to the **one** directory that owns it — `<pkg>/docs/` for *why*, `<pkg>/specs/` for
not-yet-built acceptance criteria, `docs/experiments/` for measured results, `<pkg>/README.md` for
*what and how*. Then register it: a document added to any of the eight `<pkg>/{docs,specs}/`
directories without replacing or extending that directory's `## Index` entry is an unfinished
change, and it is the likeliest way this agent breaks. Never writes the same content to two homes.

**Permissions.** `Read, Write, Edit, Glob, Grep, Bash, Skill` · `model: inherit` ·
`skills: mermaid-diagram` preloaded — the cheapest useful preload here, and every non-trivial
document carries a diagram.

- `Edit` carries weight twice: the `## Index` row and the cross-link in the owning `CLAUDE.md`
  § *Docs*. Together they are the only registry a new document gets — no package `README.md`
  links its own `docs/` or `specs/`.
- `Bash` is inspection only (`git log -S`, `git log --oneline -- <path>`, `git show`, `git blame`,
  `ls`, `cat`, `rg`), because the *why* a `docs/` file has to capture often lives only in history.
- Withheld: `WebSearch`/`WebFetch` — a repo doc citing a page nobody in the repo opened cannot be
  checked by the next reader; external research is `researcher`'s job and its report is an *input*
  here. Also `PowerShell`, `TodoWrite`, `Agent`.
- Never writes to any `insights.md`, never forks `docs/agent-prompts/README.md`, never adds
  front-matter to a repo doc — the only front-matter here is the product schema under
  `docs/skill-samples/`.

**In.** A plan, an implementation report, a diff, or a named feature.
**Out.** Documents, plus a Documentation report: the routing decision and why, files written,
**Index registration**, cross-links, diagrams, sources, and `Not documented`.

---

## refactor-planner

**Responsibility.** Plan a change that preserves behavior. The plan has two halves and the first one
is the work: a **characterization inventory** naming, for every unit inside the boundary, the
observable behavior and the test that pins it, marked `exists`, `to write` or `BLOCKED`. Then ordered
steps, each carrying an explicit claim about what must be identical afterwards. Returns
`Blocked — not a refactor` when the request changes behavior — including a bug fix — and
`Blocked — no refactor boundary supplied` when the scope would otherwise be its own to choose.

**Permissions.** `Read, Grep, Glob, Bash, Skill, Write` · `model: opus` ·
`skills: onion-architecture` preloaded — most refactors here are placement moves.

- `Write` is scoped to `.devdigest/cache/plans/refactor-<slug>.md`. The prefix is load-bearing: it
  shares a directory with `implementation-planner`'s output so `plan-verifier` consumes either with
  no new path.
- Withheld: `Edit`, `WebSearch`/`WebFetch`, `TodoWrite`, `PowerShell`, `Agent`.

**In.** A boundary — a file set, a module, a symbol, or a named duplication.
**Out.** The refactor plan, plus a digest that leads with the `BLOCKED` count.

The `BLOCKED` row is the output that justifies the agent. A unit whose behavior cannot be pinned —
a hidden dependency, a side effect with no seam, time or randomness with no injection point — does
not get refactored; it gets a seam built first, or it leaves the boundary. Refactoring behind an
unpinned unit is the failure the whole branch is shaped to prevent.

Two traps are named in the body because they are specific to this role. **The `## Do not touch`
scaffolding looks exactly like the dead code a refactor deletes** — the empty tables in
`server/src/db/schema/*` and the unused i18n namespaces are the single likeliest wrong move here.
And **a bug found mid-refactor is recorded, not fixed**: fixing it destroys the property that makes
the refactor verifiable, that green before and green after mean the same thing.

---

## refactor-implementer

**Responsibility.** Execute a refactor plan in a strictly ordered four phases, where **the order is
the entire value**: pin existing behavior in tests, prove those tests green against the
*unrefactored* code and paste the output, refactor under green one step at a time, then re-run
everything. Reverse it and the tests pin the new behavior instead of the old one — which proves
nothing and produces an identical-looking report.

**Permissions.** `Read, Write, Edit, Glob, Grep, Bash, PowerShell, Skill, TodoWrite` ·
`model: inherit` · `skills: onion-architecture` preloaded.

- `PowerShell` alongside `Bash` for the same reason `implementer` has it — Windows is a first-class
  dev box here.
- Withheld: `WebSearch`/`WebFetch`, `Agent`. Never commits, never opens a PR, never edits any
  `insights.md`, never regenerates the dependency-cruiser baseline — a refactor that would grow that
  baseline is going the wrong way.

**In.** A path under `.devdigest/cache/plans/refactor-*.md`. It refuses `implementation-planner`'s
output: a feature plan has no characterization inventory, which is the half it actually needs.
**Out.** Refactor report, built around a `### Green before the refactor` block of verbatim runner
output that is never summarized and never omitted.

Three prohibitions carry it. **A red characterization test under a step means the step is wrong** —
the step gets reverted, and editing the test to pass is the one thing it may never do, because that
converts the proof into a rubber stamp. **Phase 2 happens without reading the refactor steps**, so
knowing where the code is going cannot bias what gets asserted about where it is. And **the ugly
behavior gets pinned as-is** — if a function returns `undefined` where `null` would be right, the
test pins `undefined`, and the observation goes to `## Found, not fixed`.

It reuses `test-writer`'s `[behavior-locked]` tag with the meaning inverted, and says so in the
report. There the tag warns that a test written after the code locks in what the code *does*; here
that is precisely the intent, and a reviewer who knows only the first meaning would file the whole
report as the defect.

---

## insight-curator

**Responsibility.** Read all six `insights.md` at once — which no other agent and no ordinary
session does — and report what should change about them: duplicates across files, entries filed in
the wrong module, entries stable enough to be promoted into a `SKILL.md`, a doc or a `CLAUDE.md`
bullet, and entries the code now contradicts. `## Nothing to do` is a valid report, with a caveat in
the body that a clean result against a hundred-plus entries usually means a shallow read.

**Permissions.** `Read, Grep, Glob, Bash, Skill` · `model: sonnet` · no `skills:` key.

- **No `Write`, no `Edit`, and it is in the validator's `READONLY` set.** This is a division of
  labour, not caution: the `engineering-insights` skill owns appending and pruning, and root
  `insights.md` already records that these files get edited concurrently by parallel sessions. Two
  writers would race. This agent produces proposals precise enough to apply without re-deriving them.
- `Skill` is for reading a `SKILL.md` it proposes to change — not for loading rules to work by.
- Withheld: `Write`, `Edit`, `WebSearch`/`WebFetch`, `TodoWrite`, `PowerShell`, `Agent`.

**In.** Nothing, or a narrowed scope.
**Out.** Curation report — `Duplicates` with the owning file and the merged text, `Misrouted`,
`Promotion candidates`, `Stale`, `Unverified`, `Gaps`, `Noticed, not curated`.

A promotion needs all three of: it is stable, it would change behavior at *load* time, and it has a
named destination — plus the **exact proposed text, in the destination's voice**. A proposal the
main session has to rewrite is not finished. And every `Stale` row carries the `file:line` that
contradicts it; an entry merely doubted goes under `Unverified` instead, because age is not
staleness.

---

## Skill routing

Both `implementation-planner` and `implementer` derive their skill set from two files,
independently:

| Level | File | Keys off | Use when |
|---|---|---|---|
| 1 | [`.claude/skill-routes.md`](../skill-routes.md) | task **type** | working forward — the type is known before the exact paths |
| 2 | [`routing.md`](../skills/pr-self-review/routing.md) | changed **path** | the concrete file list exists |

Take the union. **Where they disagree, `routing.md` wins** — it is the table the PR gate applies —
and the disagreement gets reported so `skill-routes.md` is corrected rather than left to drift.

**Neither router covers `.claude/**`.** Every `skill-routes.md` type keys off a package directory,
and `always` triggers on "any item that writes TypeScript", which Markdown is not; every
`routing.md` lane keys off `client/**`, `server/**`, `reviewer-core/**` or `**/tsconfig.json`. They
do not disagree here — they are both silent, so the union is empty. That matters because
`.claude/agents/*.md` **is** inside the PR gate's scope fingerprint: `pr-review-scope.ps1:31`
excludes only `insights.md`. Without a compensating rule those files would reach the gate with zero
coverage. The two answers are a pointer in [`skill-routes.md`](../skill-routes.md) § *When this file
is wrong* back to *Authoring a new agent* below, and the `agent-frontmatter-invalid` invariant in
[`invariants.md`](../skills/pr-self-review/invariants.md).

Spec work routes through neither router either — a spec is Markdown, and the `docs` type in
`skill-routes.md` covers `<pkg>/specs/`. The distinction that matters there is ownership rather
than routing: `spec-writer` owns files under any `specs/`, `doc-writer` owns everything under
`docs/`. Both can reach a `specs/` path in principle; only `spec-writer` writes one.

`test-writer` derives its lane from neither router. The five lanes, their directories and their
runners come from [`TESTING.md`](../../TESTING.md) § *Suite map* — the only place the CI split
between the unit and integration suites is actually written down.

---

## Sources behind these agents

### Official

| Source | What it fixed here |
|---|---|
| [Create custom subagents](https://code.claude.com/docs/en/sub-agents) | The frontmatter field set; omitting `tools` inherits everything, so both use explicit allowlists; a subagent inherits no skills from its parent and needs `Skill` in `tools` to load any; `skills:` preloads full `SKILL.md` bodies; only the final message returns |
| [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) | "If you could describe the diff in one sentence, skip the plan" → the scope gate. Spec-to-file then a clean context → the plan-file handoff. The adversarial review step → review stays outside the implementer. The named failure patterns (kitchen-sink session, trust-then-verify gap, unscoped exploration) → the scope, intake and verification gates |
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Third-person descriptions; feedback loops → the conformance pass and the verification table; copyable checklists → the wiring checklist; references one level deep; no backslash paths; a default rather than a menu of choices |
| [Model configuration](https://code.claude.com/docs/en/model-config) · [model and effort](https://claude.com/blog/claude-model-and-effort-level-in-claude-code) | `model` defaults to `inherit`; the model lever goes to the implementation planner (judgement over full context), the effort lever to the implementer (one item at a time, verification it cannot skip). Same lever on the reviewers: `opus` where the work is judgement, `inherit` where it is volume against rules already loaded |
| [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) | Sectioning — "LLMs generally perform better when each consideration is handled by a separate LLM call" → four narrow agents rather than one "reviewer". Guardrails by separation — "one model instance processes… while another screens… tends to perform better than having the same LLM call handle both" → why `architecture-reviewer` and `plan-verifier` have no `Write` |
| [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | Describe it to a new team member; make implicit context explicit → repo facts live inside each agent body (package managers, i18n depths, the RTL overrides) rather than behind a link. Precise description refinements measurably cut error rates → every `description` says when to use it, what it returns and what it never does |
| [Diátaxis](https://diataxis.fr/) | The tutorial / how-to / reference / explanation split, mapped onto this repo's real folders in `doc-writer` — including the explicit statement that `<pkg>/specs/` has **no** Diátaxis quadrant and must not be renamed into one to fit |
| [Docs as code](https://www.writethedocs.org/guide/docs-as-code/) | Docs in version control, plain-text markup, reviewed in the PR → why `doc-writer` writes Markdown into the tree and why its output lands inside the PR gate's scope |
| [C4 model](https://c4model.com/) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html) | Context / Container / Component / Code as the vocabulary for architecture diagrams — but Mermaid's C4 support is flagged experimental, which together with the repo's six all-`flowchart` diagrams is why `doc-writer` mandates `flowchart` and requires a named reason for anything else |
| G-Research, *Building a code review tool: the LLM patterns that actually work* (May 2026) | Findings validate against a rule index with authoritative ids — "the standards document is the sole source of truth; the model can suggest, but never define" → "no rule id, no finding", and `WebSearch` withheld from the reviewers. Severity derived deterministically from RFC-2119 levels → the severity lookup rather than a chosen level. The two-pass recall/precision split measurably cut false positives → pass 1 / pass 2 |
| Cloudflare, *Orchestrating AI Code Review at scale* (Apr 2026) | Three levels Critical/Warning/Suggestion → the repo's contract vocabulary. An explicit "what NOT to flag" list beat positive criteria alone → § *Do not flag* and `## Optional — not gaps`. A judge pass that re-reads the source before publishing a finding → pass 2 re-opens the file. Structured output instead of advisory prose → every report template |
| He et al., *LLM-as-a-Judge for Software Engineering* (ACM TOSEM, Oct 2025) | Names sycophancy, false positives and negatives, rubber-stamping and hallucinated justifications; prescribes forced structured output, cite-the-artifact justification and refusing to conclude without evidence → the five-field evidence contract, and the ban on inferring a plan from the diff |
| arXiv 2607.05139 · arXiv 2410.21136 (test generation) | Oracle bias / test inversion — tests generated after the code check what it *does*, not what it *should*; LLM oracles "capture the actual program behaviour rather than the expected one". Mitigation is ordering → `test-writer`'s two modes, the `Derived from` column, and the `[behavior-locked]` tag |
| HALLMARK, arXiv 2607.18360 | For verifiers the bottleneck is the false-positive rate, not recall, and tool-augmented verifiers buy recall by inflating FP → `model: opus` on both reviewers, the mandatory `## Dropped in pass 2`, and the precision pass in `plan-verifier` |
| [Verbalized Sampling, arXiv 2510.01171](https://arxiv.org/html/2510.01171v1) | RLHF'd models collapse toward the single most typical answer; asking for a *set* of k candidates with explicit confidences recovers 1.6-2.1× diversity, and quality degrades when k grows too large (k=5 used) → `brainstorm`'s "4 or 5, never three" and the mandatory per-option confidence |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Vague subagent briefs made subagents duplicate each other; the fix was an objective, an output format, tool guidance and explicit boundaries per subagent → `brainstorm`'s named-axis requirement, which is the same fix applied to options instead of researchers. Also the 15× token cost of fan-out → `/feature-workflow`'s stage-0 gate |
| [Judging LLM-as-a-Judge, arXiv 2306.05685](https://arxiv.org/abs/2306.05685) | Position and verbosity bias — the first and the longest candidate get scored higher → `brainstorm` states its option order is arbitrary, caps each mechanism at three sentences, and confines ranking to `## Recommendation` |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) + its [prompt](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md) | The five categories; "exploit scenario demonstrating real-world impact" as a required field; the confidence threshold; and the exclusion list — reproduced in `security-reviewer` § *Do not flag* and extended with three repo-specific entries. Note it publishes **no CRITICAL tier** (HIGH/MEDIUM/LOW only), so the mapping onto this repo's contract vocabulary is a local decision, not an inherited one |
| [Automated security reviews in Claude Code](https://support.claude.com/en/articles/11932705-automated-security-reviews-in-claude-code) | Review is scoped to pending changes while the agent still explores the repo for context → "review the diff, read beyond it freely, report only inside it" |
| [OWASP Top 10:2025](https://owasp.org/Top10/2025/) · [OWASP Risk Rating](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology) | The ten current ids, and which of them a *diff-scoped* review can honestly cover — A03, A06 and A09 need lockfile or whole-system context, so they are advisory-only and can never be CRITICAL. Risk = likelihood × impact → the severity table, so the level is derived rather than chosen |
| arXiv 2605.23243 · arXiv 2509.01494 | Measured 10-50 % false-positive rates for general-purpose LLMs in security review, with precision as the dominant limiter of F1 → the taint-path requirement and the 0.8 confidence gate. 2509.01494 also documents contextual-bias injection, where adversarial PR metadata systematically shifts vulnerability judgments → `security-reviewer` never treats a branch name, commit message or PR description as evidence |
| Refute-or-Promote, arXiv 2604.19049 | An explicit refutation stage before a finding is promoted is the precision mechanism → `security-reviewer`'s pass 2 answers four refutation questions in writing before anything reaches `## Findings` |
| [curl ends its bug bounty over AI-generated reports](https://www.theregister.com/2025/05/07/curl_ai_bug_reports/) | Unbounded LLM security output is the real-world failure mode — triage load, not wrong findings, is what kills the practice → the 10-finding cap and "never pad toward a count" |
| arXiv 2607.05139 · arXiv 2410.21136 (test generation), read the other way | The same oracle-bias result that shapes `test-writer` is the *definition* of a characterization test → `refactor-implementer` pins behavior deliberately, reuses the `[behavior-locked]` tag with the meaning inverted, and says so in its report so a reviewer does not file the intent as the defect |

### From this repo

| Source | What it fixed here |
|---|---|
| [researcher.md](researcher.md) | The house agent shape: entry gate → numbered workflow → fenced report template → `## Rules` → a mandatory negative-result section |
| Root `CLAUDE.md` — *Session protocol*, *Do not touch*, *Conventions* | Read `insights.md` first and state the top 3; the scaffolding that must never be "cleaned up"; no lint tooling, ever |
| [`routing.md`](../skills/pr-self-review/routing.md) + `invariants.md` | Level 2 of the router, and the 14 mechanical CRITICAL checks a plan must not produce — one of which, `agent-frontmatter-invalid`, exists because of the agents in this directory |
| Root `insights.md` | Package-manager discipline governs `exec`, not just install; a skill can confidently describe a codebase this repo does not have, so `insights.md` wins on conflict; agent-file authoring traps |
| [`pr-gate.ps1`](../hooks/pr-gate.ps1) + `.gitignore` | Why the implementer never touches `gh pr *` or `DEVDIGEST_PR_GATE`, and why plans live under `.devdigest/cache/` |
| `TESTING.md` + `server/CLAUDE.md` | The `*.it.test.ts` suffix rule and the per-package verification commands |
| [`implementation-planner.md`](implementation-planner.md) (the plan template, `:132-218`) + [`implementer.md`](implementer.md) (its report template) | Fixed section names, so `plan-verifier` extracts items mechanically rather than by reading prose; and the implementer's `Deviations` / `Not done`, which are reconciled against, never re-opened |
| [`onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) | The rule catalog `architecture-reviewer` cites by id, its six grep probes, the audit procedure and finding-line format, "a clean diff is a valid and common result", the `vi.mock` ban and the container test seam, and the 27-row known-debt table it must not re-report |
| [`pr-review-scope.ps1`](../hooks/pr-review-scope.ps1) (`:31`) | Only `insights.md` is excluded from the scope fingerprint, so `.claude/agents/*.md` **is** in the PR gate's scope while no `routing.md` lane covers it — the whole reason the `agent-frontmatter-invalid` invariant exists |
| [`skill-routes.md`](../skill-routes.md) + `skills-lock.json` | Level 1 of the router, which now carries a `docs` type and the `.claude/**` note; and that neither `pr-self-review` nor `react-testing-library` is locked, so both are hand-authored and legitimately edited in place |
| `TESTING.md` § *Suite map* · `client/insights.md` · `client/package.json` | `test-writer`'s five lanes with their directories and runners; `toHaveBeenCalledTimes(1)` first on a router spy, and confirm the test fails before the fix; the 3 / 7 / 8 `..` i18n import depths; and the verified absence of `@testing-library/user-event` and `msw` |
| `docs/agent-prompts/README.md` + `reviewer-core/src/prompt.ts` | The `INJECTION_GUARD` and the `<untrusted>` wrapping are the product's *mitigation*, and skill bodies sit in the user message so an imported skill cannot outrank the agent's own authority → the entry in `security-reviewer` § *Do not flag* that stops it filing the product's core design as a prompt-injection hole |
| `reviewer-core/insights.md:14` | A skills-vs-no-skills comparison is meaningless when the skill restates the agent's own prompt — measured at +105 % input tokens for no behavioral change → why `security-reviewer` keeps the *taxonomy* in the preloaded skill and the *procedure* in the body, with no overlap |
| Root `insights.md:83` — concurrent edits to `insights.md` and the skills catalog | Why `insight-curator` has no `Write` at all: `engineering-insights` owns appending, and a second writer would race sessions already known to edit these files in parallel |
| Root `CLAUDE.md` § *Do not touch*, read from the refactor side | The intentional scaffolding is indistinguishable from dead code to anything doing a structural cleanup → the named trap in both refactor agents, and the reconfirmation section at the end of the refactor plan |
| The eight `<pkg>/{docs,specs}/README.md` · `docs/agent-prompts/README.md` · `docs/experiments/` | `doc-writer`'s `## Index` registration duty and the `_Empty. Add a link here…_` placeholder rule; the single home for reviewer prompt originals, which is never forked; and the Hypothesis / Fixture / Method / Results / Conclusion shape of an experiment report |

---

## Authoring a new agent

Three traps. The first two fail as an indistinguishable `Agent type '<name>' not found`; the third
never errors at all.

- `tools` is a **comma-separated string**; `skills` is a **YAML block sequence** (`  - name` per
  line). They are not symmetric.
- `allowed-tools` and `disable-model-invocation` are **Skill-only** fields. Copying them out of a
  `SKILL.md` into an agent silently does nothing.
- `skills:` preloads **bodies only** — each named skill's whole `SKILL.md` and none of its sibling
  files, so preloading `pr-self-review` yields the review pipeline and *not* `routing.md`. Reaching
  a sibling still needs `Skill` in `tools`, and **without `Skill` in `tools` a subagent cannot load
  any skill at all**, at any point in its run. Nothing reports this: the agent starts, and simply
  never has the rules you thought you had given it.

Validate out-of-band before believing any "not found" error — the registry is read at session
start, so a *correct* new file is not invocable in the session that wrote it either.
[`scripts/check-agent-frontmatter.mjs`](../../scripts/check-agent-frontmatter.mjs) is that check:
one `PASS`/`FAIL` line per agent, non-zero exit on any failure. It resolves every path off its
own location — including the YAML parser `pnpm install` already put in
`server/node_modules/yaml` — so it runs from any directory, with no `cd` and no package manager
involved:

```bash
node scripts/check-agent-frontmatter.mjs
```

Per agent file it asserts: the frontmatter parses as YAML; `name` equals the filename stem;
`description` is a string longer than 120 characters; `tools` is a comma-separated **string**, not
an array; `skills`, if present, is an array — and `plan-verifier` omits the key entirely; every
`skills` entry resolves to a real `.claude/skills/<name>/SKILL.md`; no Skill-only key
(`allowed-tools`, `disable-model-invocation`) is present; every tool name is known, and neither
`Write` nor `Edit` appears in any agent in the `READONLY` set below; `Edit` does not appear in
any agent in the `WRITE_SCOPED` set; and `model`, if present,
is one of `opus | sonnet | haiku | inherit`. It also prints each agent's preloaded `SKILL.md` byte
total and flags anything over 25 KB — advisory only, that never changes the exit code.

The `READONLY` assertion is the one that keeps paying: the realistic regression is a withheld tool
creeping back into a read-only agent during a later edit, and nothing else in the repo would notice.
The set is now four — `architecture-reviewer`, `plan-verifier`, `security-reviewer`,
`insight-curator` — and it is worth confirming the assertion still bites rather than assuming it,
by adding `Write` to one of them, running the check, and reverting:

```
FAIL security-reviewer.md · preload 13.7 KB — Write must stay withheld
```

`brainstorm` and `refactor-planner` are deliberately **not** in that set: both write, each to
exactly one gitignored path, and that scoping lives in the agent body rather than in the validator. The `description.length` floor catches the other silent case — a `: `
(colon-space) inside an unquoted `description` either throws or truncates the scalar. The findings
behind each trap are in the root [`insights.md`](../../insights.md) under *Tool & Library Notes*;
`.claude/skills/pr-self-review/invariants.md` makes this check blocking as
`agent-frontmatter-invalid`.

`name` and `description` are required, so a file without frontmatter is not a valid definition —
but the docs don't say whether such a file is skipped silently or logged as an error. This README
has no frontmatter and is the live test: if a bogus entry shows up in the agent list, that is the
answer. The shared router still lives at `.claude/skill-routes.md` rather than here, on the
conservative side of that unknown.
