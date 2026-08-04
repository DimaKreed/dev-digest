# Experiment — does attaching skills change what a reviewer catches?

**Status:** executed 2026-08-04. Six runs — three per arm, not one — because the
first pair matched exactly and a single sample could not tell a real effect from
LLM variance. Every number below is read from `agent_runs` and the run trace.

**Headline: the success criterion was NOT met, and not because the skills
failed — because the baseline never failed.** The agent caught the breaking
change with a grounded CRITICAL in **6 of 6** runs, in both arms. The skills did
change two things measurably, both narrower than the hypothesis: they fixed the
**caller line number** (3/3 correct with skills, 0/3 without) and they added the
semver metadata finding. See [Conclusion](#conclusion).

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
   (`server/src/modules/agents/service.ts`) — verified live, message
   `Cannot attach a disabled skill: deprecation-policy. Enable it first.`
   Note `enabled: false` on import is a **client-side** default in the import
   drawer, not a server one: `POST /skills` with `source: 'imported_file'` and no
   `enabled` field lands `enabled: true`.
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

Agent `99cd4a50` · PR #484 · `openrouter` / `deepseek/deepseek-v4-flash` ·
`single-pass` · `repo_intel: true` (degraded — `acme/payments-api` has no index).
Arm B links `breaking-change`, `response-schema`, `semver-discipline`,
`deprecation-policy` at `order` 0–3.

| Metric | A1 — no skills | B1 — with skills |
|---|---|---|
| Run id | `c4924e6d` | `e4eff8ad` |
| CRITICAL | 1 | 1 |
| WARNING | 1 | 1 |
| SUGGESTION | 0 | 0 |
| Total findings (grounded) | 2 | 2 |
| Score | 53 | 53 |
| Verdict | `request_changes` | `request_changes` |
| Blockers (CRITICAL count) | 1 | 1 |
| Grounding (kept/total) | 2/2 passed | 2/2 passed |
| Findings dropped by grounding | 0 | 0 |
| Tokens in / out | 2184 / 2279 | 4491 / 2051 |
| Cost (USD) | 0.00059370 | 0.00075670 |
| Wall time | 50.8s | 42.8s |

The first pair is byte-identical on every aggregate. That is why the experiment
was repeated — see below.

### All six runs

`tokens_in` is **exactly** constant within each arm (2184 / 4491), which
confirms prompt assembly is deterministic and that the only injected difference
is the 2259-token skills block (`prompt_assembly.skills_tokens`).

| Run | Skills | C / W / S | Score | Verdict | Grounding | tok in / out | Cost (USD) | Dur |
|---|---|---|---|---|---|---|---|---|
| A1 `c4924e6d` | — | 1 / 1 / 0 | 53 | `request_changes` | 2/2 | 2184 / 2279 | 0.00059370 | 50.8s |
| A2 `77cc475f` | — | 2 / 0 / 0 | 30 | `request_changes` | 2/2 | 2184 / 775 | 0.00033145 | 16.3s |
| A3 `f91347d1` | — | 2 / 0 / 0 | 30 | `request_changes` | 2/2 | 2184 / 719 | 0.00017852 | 12.8s |
| B1 `e4eff8ad` | 4 | 1 / 1 / 0 | 53 | `request_changes` | 2/2 | 4491 / 2051 | 0.00075670 | 42.8s |
| B2 `a1d9967b` | 4 | 2 / 0 / 0 | 30 | `request_changes` | 2/2 | 4491 / 888 | 0.00055942 | 14.1s |
| B3 `87bdb14c` | 4 | 1 / 2 / 0 | 41 | `request_changes` | 3/3 | 4491 / 872 | 0.00024781 | 16.7s |

Every score matches `100 − (35·C + 12·W + 3·S)` exactly — 1C+1W = 53, 2C = 30,
1C+2W = 41 — so the scores are a pure function of the surviving findings, as
designed.

**Within-arm spread (30–53) is larger than any between-arm difference.** Score
alone therefore cannot distinguish these arms, and a single run per arm would
have been indistinguishable from noise. Grounding dropped nothing in any run
(6/6 arms clean), so no finding was ever hallucinated onto a non-existent line.

### The decisive finding

Did Run B report the `getInvoice` signature break with the un-updated
`src/jobs/reconcile.ts` caller cited?

Yes — in **every** run of **both** arms.

| | A1 | A2 | A3 | B1 | B2 | B3 |
|---|---|---|---|---|---|---|
| Break reported at all | yes | yes | yes | yes | yes | yes |
| Severity assigned | CRITICAL | CRITICAL | CRITICAL | CRITICAL | CRITICAL | CRITICAL |
| Producer line cited | `invoices.ts:12-13` | `:12-12` | `:12-12` | `:12-12` | `:12-13` | `:12-12` |
| Un-updated caller named | yes | yes | yes | yes | yes | yes |
| **Caller line cited** | **10 ✗** | **10 ✗** | **10 ✗** | **9 ✓** | **9 ✓** | **9 ✓** |

The one clean, repeatable difference the skills made. `getInvoice(row.id)` sits
on **line 9** of the new side of `src/jobs/reconcile.ts` — the hunk starts at
line 6 (`export async function reconcile() {`), so 7 is `const rows`, 8 is the
`for`, 9 is the `getInvoice` call, and 10 is the `postToLedger` line that the
diff actually changed. Without skills the model reported the line it saw marked
as changed; with skills it reported the line the call is on, 3/3 both ways.

This is invisible to grounding: the CRITICAL's structured `file`/`start_line`
point at the **producer** (`src/api/invoices.ts`), which exists in the diff, so
the finding grounds cleanly either way. The caller line lives in prose. A wrong
line number in a reviewer's rationale is exactly the kind of error that costs a
human reader trust, and nothing in the pipeline catches it.

### Findings side by side

> One row per distinct finding; mark the ones unique to a run.

| Finding | Severity seen | A1 | A2 | A3 | B1 | B2 | B3 |
|---|---|---|---|---|---|---|---|
| `getInvoice` gains a required `opts`, `reconcile.ts` not updated | CRITICAL in all 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/invoices/:id` → `/v2/invoices/:id` with no deprecation | CRITICAL in A2/A3/B2, WARNING in A1/B1/B3 | W | C | C | W | C | W |
| PR title/description understate a MAJOR change | WARNING | — | — | — | — | — | ✓ |
| Response selection widened (`includeVoid` → which rows return) | never reported | — | — | — | — | — | — |

Two things to read off this:

- The **route change severity is unstable in both arms** (CRITICAL 2/3 in A,
  1/3 in B). Skills nudge it toward WARNING, which is the better answer here —
  no consumer of the old route is visible in the diff, and `deprecation-policy`
  says WARNING is the default "for a silent removal whose broken callers are
  already reported elsewhere". But 2/3 vs 1/3 on n=3 is not a result, only a
  direction.
- The `semver-discipline` metadata finding appears **only** in arm B, and only
  once. It is the one finding no baseline run produced.

### Which skill fired

| Skill | Element of #484 it targets | Fired in arm B | Attributable? |
|---|---|---|---|
| `breaking-change` | required `opts` added to exported `getInvoice`; `reconcile.ts` still calls it with one argument | yes, 3/3 | **No** — arm A did the same 3/3. Only its "cite the un-updated caller's `file:line`" clause is attributable: 3/3 correct vs 0/3. |
| `response-schema` | `findById(id, opts.includeVoid)` changes which rows the endpoint returns for an unchanged request | **no, 0/3** | n/a — never fired in either arm. |
| `semver-discipline` | a major-breaking diff described as an additive option | 1/3 standalone WARNING; MAJOR named in B1's summary | **Yes** — 0/3 in arm A. |
| `deprecation-policy` | `/invoices/:id` deleted in the same commit that adds `/v2/invoices/:id` | yes, 3/3 | **No** — arm A reported the route change 3/3 too. Its severity guidance is weakly attributable (WARNING 2/3 vs 1/3). |

`response-schema` never firing is the most interesting miss. The diff really does
change which rows an unchanged request returns — `findById(id, opts.includeVoid)`
— and that is precisely the skill's "change to the **selection predicate** behind
a response" bullet. No run in either arm reported it, so on this fixture that
skill contributed 2259/4 ≈ 565 prompt tokens per run for nothing.

## Conclusion

**1. Was the criterion met? No.** The criterion was "with-skills catches a
breaking change that without-skills misses". Without-skills never missed it: 3/3
grounded CRITICALs naming `reconcile.ts`, verdict `request_changes`. The
hypothesis at the top of this document — that the baseline "does not treat it as
a break" — is simply false for this agent on this fixture.

The reason is visible in the agent prompt itself. `docs/agent-prompts/api-contract-reviewer.md`
already instructs the model to read "**unchanged context lines**" for call sites,
already defines CRITICAL as requiring "a caller … not updated to match", and
already says "Cite the producer-side line **and** the consumer-side line". The
four skills largely restate what the system prompt says. **The experiment
accidentally measured prompt redundancy rather than skill value** — with a
deliberately weak baseline prompt the result would likely differ, and that is the
variable to change next, not the fixture.

**2. What did the skills add, mechanically?** One clear thing and one weak thing.
Clear: the **caller line number became correct** (9 instead of 10) in 3/3 runs,
attributable to `breaking-change`'s explicit "cite … the un-updated caller's
`file:line`" clause — the baseline instead cited the line the diff marked as
changed. Weak: `semver-discipline` produced one standalone WARNING that no
baseline run produced, and pushed the route-change severity toward WARNING.
`response-schema` fired 0/3 despite the diff containing exactly its target case.

**3. What did they cost?** +2307 prompt tokens per run, a **105% increase** in
input (2184 → 4491), constant to the token across runs. On the matched A1/B1
pair, cost rose 27% (0.000594 → 0.000757 USD). Absolute cost is trivial on a
flash model; the ratio is what would matter at scale. For that price the arm
bought one correct line number and one extra WARNING — worth it for the line
number if a human reads the rationale, hard to justify on findings count alone.

**4. False positives.** None grounded-out: grounding kept 2/2, 2/2, 2/2, 2/2, 2/2
and 3/3 — nothing was dropped in any run, in either arm, so no run invented a
line range. The one severity that looks inflated is the route change reported as
CRITICAL (A2, A3, B2): no consumer of `/invoices/:id` is visible anywhere in the
provided material, and the agent prompt reserves CRITICAL for "a concrete broken
caller or an unambiguously removed public contract". A deleted route arguably
satisfies the second clause, so this is defensible rather than plainly wrong —
but it is unstable across runs in both arms, which is itself a finding.

**5. Generality check.** Mixed. `breaking-change`'s worked example is a
`renderChart(data, theme)` signature change with a stale `renderChart(series)`
caller — structurally identical to #484's `getInvoice`, so its success here is
partly fixture-shaped. Its *rules* are general (required parameter added,
optional→required, type narrowed) and none name a symbol from #484, so nothing
reads as a lookup table. `deprecation-policy`'s example is likewise a
`/reports/:id` → `/v2/reports/:id` move, matching #484's route change closely.
Before reusing these, test them on a change class **absent** from their examples
— a removed response field, or a reordered positional parameter.

**6. Threats to validity.** Single fixture, single model, single PR, 3 runs per
arm. Three runs is enough to show the decisive CRITICAL is stable (6/6) and that
score is not (30–53), but far too few to call the route-severity shift (2/3 vs
1/3) or the one-off semver finding real. The caller-line result (3/3 vs 0/3) is
the only difference clean enough to act on, and even that is n=3 with a perfect
split. The runs also sit behind OpenRouter's provider routing, which varies per
call and is not pinned here, so upstream model deployment is an uncontrolled
variable across all six runs.

**What to change before re-running:** weaken the agent's system prompt to a plain
"review this diff for API contract safety" and re-run both arms. That isolates
skill contribution from prompt redundancy, which is the question this experiment
was meant to answer.
