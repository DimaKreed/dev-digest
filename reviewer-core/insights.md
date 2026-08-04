# Insights — reviewer-core

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

### A skills-vs-no-skills A/B is meaningless until you diff the skills against the agent's own system prompt
**Symptom:** the API Contract Reviewer experiment predicted the no-skills arm would read PR #484's
renamed route + newly-required parameter as an ordinary feature diff. It didn't: the baseline
produced a grounded CRITICAL naming the un-updated caller in **3 of 3** runs, 6/6 across both arms,
verdict `request_changes` every time. The four `docs/skill-samples/api-contract/` skills largely
restate what `docs/agent-prompts/api-contract-reviewer.md` already says — read "unchanged context
lines" for call sites, reserve CRITICAL for a caller "not updated to match", cite both lines. The
experiment measured prompt/skill OVERLAP, not skill value, and cost +105% input tokens to do it.
**Rule:** before running one, grep the agent's `system_prompt` for the rules the skills assert; every
overlap is a variable you have already fixed. Vary the baseline prompt, not the fixture. And use
≥3 runs per arm — within-arm score spread was 30–53 here (`100 − (35·C + 12·W + 3·S)` on a
CRITICAL-vs-WARNING flip for the same route change), which is wider than any between-arm difference,
so n=1 per arm cannot separate signal from sampling. Full data:
`docs/experiments/api-contract-reviewer.md`.
_2026-08-04_

## Codebase Patterns

## Tool & Library Notes

### OpenRouter picks a different upstream per call, and a client timeout shorter than the slow tail turns retries into a lottery you pay for repeatedly
**Symptom:** one conventions scan took **13m48s**. Not tokens and not the schema — timings for the
identical request, same model (`deepseek/deepseek-v4-flash`), same payload: Morph **4.7s**, AtlasCloud
30.7–63.4s, Fireworks 41.1s, Parasail 53.6s, Venice 70.4s, DigitalOcean **166.9s**. A 35× spread.
`OpenRouterProvider` built its client with `timeout: 90_000, maxRetries: 2`
(`src/llm/openrouter.ts:54-55`) inside `completeStructured`'s own 3-attempt repair loop (`:68`), so
any draw past 90s was abandoned *mid-generation* and retried — drawing again from the same
distribution. 3 × 3 × ~92s ≈ 13.8 min, matching the observation. The generation was paid for
several times and waited for never.
**Rule:** for a long single call, raise the per-request timeout rather than letting it retry —
waiting out the slowest observed provider costs 170s once, abandoning it costs 90s and buys another
ticket. `StructuredRequest.timeoutMs` existed in the contract and `adapters/llm/openai.ts` already
honoured it; this provider silently ignored it and applied the constructor value to every call. It
now passes it through (`src/llm/openrouter.ts`), and `EXTRACTION_TIMEOUT_MS = 300_000` in
`server/src/modules/conventions/constants.ts` is the one caller that asks for headroom. Corollary
when timing anything through this provider: a single wall-clock number is close to meaningless —
the same scan measured 828s and 127s on identical code hours apart.
_2026-08-04_

## Recurring Errors & Fixes

## Session Notes

## Open Questions

### Does `provider: { sort: 'throughput' }` trade anchor fidelity for speed?
Tried during session 2 and reverted. It pins routing hard — 4/4 calls went to Alibaba at 2.1–2.6s,
far faster than any default draw — but the fidelity half of that measurement was taken with a
**broken fixture** (a payload whose `<file path="...">` attributes were all the string `undefined`,
because `path.join` on Windows yields backslashes and the generator split on `/src/`), so the "0%
anchor verification" it appeared to show proves nothing. The valid rerun on a real fixture scored
14/14 anchors on Venice under default routing. So the question is open: does the fastest provider
copy a source line exactly, or does throughput routing systematically pick deployments that cannot?
Answer it before reaching for `sort` again — the payoff (removing the latency lottery at its root)
is real if fidelity holds.
_2026-08-04_
