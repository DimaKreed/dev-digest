# Experiment — does attaching skills change what a reviewer catches?

**Status:** skeleton. Every `TBD` below is filled in after both runs execute.
Do not guess a number here; a fabricated result is worse than an empty cell.

## Hypothesis

The **API Contract Reviewer** agent, run **without** linked skills, reports the
surface change in PR #484 (a new option, a new route path) as a normal feature
diff and does not treat it as a break. The **same** agent, with the four
`api-contract` skills linked, identifies the same diff as a breaking change and
returns at least one CRITICAL finding that cites both the changed contract and
the un-updated caller.

Success criterion for the assignment: **with-skills catches a breaking change
that without-skills misses.** A finding counts only if it survives citation
grounding and names both sides of the break.

## Fixture

Seed PR **#484 — "Support voided invoices in the invoice endpoint"**
(`server/src/db/seed-pulls.ts`). Two files, both in the diff:

| File | What it does |
|---|---|
| `src/api/invoices.ts` | Renames the route `/invoices/:id` → `/v2/invoices/:id`; adds a required `opts: { includeVoid: boolean }` parameter to the exported `getInvoice`. |
| `src/jobs/reconcile.ts` | Unchanged context: still calls `getInvoice(row.id)` with one argument. |

Both sides of the break are visible in the same diff, so the finding is
reachable with no repo access and no callers index. The PR description frames the
change as additive ("Adds an includeVoid option"), which is the trap.

## Method

Two runs. **Same agent, same PR, same model, same strategy.** The only variable
is the set of linked skills.

| | Run A — baseline | Run B — with skills |
|---|---|---|
| Agent | API Contract Reviewer | the *same* agent record |
| Linked skills | none | `breaking-change`, `response-schema`, `semver-discipline`, `deprecation-policy` |
| PR | #484 | #484 |
| Model / strategy | unchanged between runs | unchanged between runs |

### Setup steps

1. Create the agent from `docs/agent-prompts/api-contract-reviewer.md`.
2. Import the four skills from `docs/skill-samples/api-contract/`.
   Imported skills land **`enabled: false`**.
3. **Enable each skill before linking it.** Linking enforces "linked ⇒ enabled":
   attaching a disabled skill returns `400 skill_disabled`
   (`server/src/modules/agents/service.ts`).
4. Run A first, with zero skills linked.
5. Link all four, then Run B. Change nothing else.

### Why the runs are comparable

- **Score is deterministic**, never taken from the model:
  `100 − (35·CRITICAL + 12·WARNING + 3·SUGGESTION)`, clamped to 0–100
  (`reviewer-core/src/review/reduce.ts`). The score is a pure function of the
  findings that survived grounding, so it cannot drift independently of them.
- **The baseline is visually verifiable.** With no skills attached, the
  `## Skills / rules` block is omitted from the user message **entirely**
  (`reviewer-core/src/prompt.ts`), and the run trace shows
  `skills: none attached`. Run A's prompt is byte-identical to the same review
  before skills existed.
- **Skill bodies are concatenated verbatim**, joined with `\n\n` in
  `agent_skills.order`, and are not `<untrusted>`-wrapped. Reordering the links
  changes the prompt, so keep the order fixed across repeats.
- **Findings are citation-grounded**: a finding whose line range misses a real
  diff hunk is dropped before scoring (`reviewer-core/src/grounding.ts`). The
  trace reports it as `kept/total passed`.

## Results

> Fill from the run trace and the review record. `grounding` is the
> `kept/total passed` figure; `cost` is the run's reported USD.

| Metric | Run A — no skills | Run B — with skills |
|---|---|---|
| Run id | TBD | TBD |
| CRITICAL | TBD | TBD |
| WARNING | TBD | TBD |
| SUGGESTION | TBD | TBD |
| Total findings (grounded) | TBD | TBD |
| Score | TBD | TBD |
| Verdict | TBD | TBD |
| Blockers (CRITICAL count) | TBD | TBD |
| Grounding (kept/total) | TBD | TBD |
| Findings dropped by grounding | TBD | TBD |
| Tokens in / out | TBD | TBD |
| Cost (USD) | TBD | TBD |
| Wall time | TBD | TBD |

### The decisive finding

Did Run B report the `getInvoice` signature break with the un-updated
`src/jobs/reconcile.ts` caller cited?

| | Run A | Run B |
|---|---|---|
| Break reported at all | TBD | TBD |
| Severity assigned | TBD | TBD |
| Producer line cited | TBD | TBD |
| Un-updated caller cited | TBD | TBD |

### Findings side by side

> One row per distinct finding; mark the ones unique to a run.

| Severity | Title | File:line | Run A | Run B |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

### Which skill fired

| Skill | Element of #484 it targets | Fired in Run B |
|---|---|---|
| `breaking-change` | required `opts` added to exported `getInvoice`; `reconcile.ts` still calls it with one argument | TBD |
| `response-schema` | `findById(id, opts.includeVoid)` changes which rows the endpoint returns for an unchanged request | TBD |
| `semver-discipline` | a major-breaking diff described as an additive option | TBD |
| `deprecation-policy` | `/invoices/:id` deleted in the same commit that adds `/v2/invoices/:id` | TBD |

## Conclusion

> Written after the table is filled. Answer, in order:

1. **Was the criterion met?** Did Run B produce a grounded CRITICAL for the
   `getInvoice` break that Run A did not?
2. **What did the skills add, mechanically?** Which specific instruction changed
   the model's behaviour — the "scan unchanged context lines for callers" rule,
   the "cite both lines" requirement, the explicit CRITICAL threshold, or the
   semver reframing of an "additive" description?
3. **What did they cost?** Delta in prompt tokens and USD per run, and whether
   the extra findings justified it.
4. **False positives.** Did Run B report anything the diff does not support —
   especially findings dropped by grounding, or a severity the diff cannot carry?
5. **Generality check.** Would the skills have fired on a *different* codebase
   with the same class of change, or did they succeed only because the fixture
   matches their examples? If any rule reads as a lookup table for #484, rewrite
   it before reusing it.
6. **Threats to validity.** Single fixture, single model, single run per arm; LLM
   output is non-deterministic even at fixed inputs. Note how many repeats were
   run and whether the outcome was stable across them.
