---
name: workflow-retro
description: Grades a finished multi-agent run — what it cost, in what order agents fired and which actually overlapped, where each agent struggled, what ground was covered twice, and what nobody covered — from the session transcript rather than from memory. Runs only when the user invokes /workflow-retro. Writes one gitignored report under .devdigest/cache/retros/ and never appends to any insights.md.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write
argument-hint: "[optional: the run slug, or --session <id>]"
---

# Workflow retro

Grades **the run, not the code**. `/pr-self-review` judges the diff; this judges the machinery that
produced it — cost, ordering, wasted parallelism, agents given bad inputs, ground covered twice,
ground covered by nobody.

**Manual only.** `disable-model-invocation: true` in the frontmatter above is what enforces that,
and it is deliberate: a retro that fires by itself on every chain run is another fixed cost on
exactly the runs whose cost is under examination. Never add a call to this skill to root
`CLAUDE.md`, and never add it to `feature-workflow` stage 9.

## The one constraint that shapes everything

**Per-agent cost is observable live, at completion, once — and is unrecoverable afterwards.**

An agent's completion notification carries `subagent_tokens`, `tool_uses` and `duration_ms`. That
notification is injected into the caller's live context and is **never written to the transcript** —
verified: zero `<task-notification>` lines in a session that received three. The subagent's own
transcript under `tasks/*.output` is 0 bytes, and there are no `isSidechain` lines.

Two consequences, both load-bearing:

1. **A same-session retro can report real per-agent cost. A retro of a past session cannot.** In
   the same session, the figures are still in your context — transcribe them. For an earlier
   session, per-agent cost is gone; say so and grade what remains.
2. **Which files an agent read is never recoverable.** Duplication and coverage findings are
   inferences from artifacts and returned reports, and must be labelled as such.

## Gate

Needs a transcript with at least one `Agent` launch. Zero agents ⇒ say there is no run to grade and
stop; that is a complete outcome, not a failure.

`.devdigest/cache/runs/<slug>.md` is **optional** input. It carries stage semantics, verdicts and
human-gate rows the transcript cannot know. Read it when it exists; say plainly when it does not,
and grade without it rather than inventing stages.

## Gather, in this order

**1. The skeleton — the only source of a number about the run's shape.**

```bash
node scripts/session-retro.mjs --table          # orientation
node scripts/session-retro.mjs --json           # what you actually work from
```

Exact from the transcript: launch order, `subagent_type`, `resolvedModel`, description, prompt size,
main-session token usage, `launchedTogether`, and which skills the main session loaded.

**2. Per-agent cost, if this is a same-session retro.** Transcribe the figures from the completion
notifications in your context into a JSON file, then re-run with it merged:

```jsonc
// one entry per agent, keyed by the agentId the Agent tool returned
{ "a5c06e2329179dd78": { "tokens": 63768, "toolUses": 13, "durationMs": 149695 } }
```

```bash
node scripts/session-retro.mjs --json --usage <file>
```

Only then are `agentTokens`, `parallelismRatio` and `actuallyConcurrent` computed. Transcribe only
figures you can actually see. A number you cannot see is `null`, never an estimate — and
`actuallyConcurrent: null` means *unknown*, not *nothing overlapped*.

**3. The run trace and the artifacts** — `.devdigest/cache/{options,plans}/<slug>.md`, the spec, and
the reviewer verdicts as recorded in the trace. These are the only evidence for duplicated ground
and coverage gaps.

## The report

Write to `.devdigest/cache/retros/<slug>.md` — gitignored via `.gitignore:19` (`.devdigest/cache/`),
so it stays local per developer and out of the PR gate's scope fingerprint. Use the run's slug when
there is one, else a kebab-case slug from the goal. Sections in this order:

| Section | Holds |
|---|---|
| `## Run shape` | session id, branch, wall span, agent count; the launch-order table; `launchedTogether` vs `actuallyConcurrent` |
| `## Cost` | session totals; per-agent tokens / tool calls / wall; agent-vs-main split; summed agent wall against session wall; which stage bought the most per token |
| `## Friction & ease` | per agent: tokens per tool call, re-runs, `blocked` / `partial` verdicts, and what that says about the *input* it was given |
| `## Duplicated work & gaps` | ground re-derived across agents; what nobody covered — an uncovered `AC-NN`, a package no reviewer saw. Every item marked `inferred` |
| `## Prompt quality & gate audit` | was each agent's input sufficient; were the stage-3 and stage-5 human gates honoured or quietly decided for the user; was any agent re-run to get a different answer |
| `## Candidates for /engineering-insights` | exact proposed entry text plus destination file and section — **proposals only** |

Two things to read for, because nothing else in the repo looks for them:

- **`launchedTogether` without `actuallyConcurrent`** — agents sent in one message that nonetheless
  ran serially. That is wasted wall time and it is invisible in the run trace.
- **A `parallelismRatio` near or below 1** — the fan-out bought little. Worth naming, since
  `feature-workflow` mandates parallel stages precisely to avoid paying that wall time.

## Rules

- **Every number traces to a source.** The script's JSON, or a completion notification you can see
  in this session. No estimates, no back-of-envelope token maths, no per-agent figure for a past
  session. `unavailable` is a correct value.
- **Label every inference.** Friction, duplication and coverage are read off indirect signals,
  because subagent internals are not on disk. Name the observation each conclusion rests on.
- **Never append to any `insights.md`.** Candidates are proposals; the user promotes them by calling
  `/engineering-insights`, which owns those six files along with their routing, dedupe and quality
  bar. A second writer bypasses all three.
- **Zero candidates is a valid and common outcome.** A run that went well is a finding; say so
  rather than manufacturing a lesson.
- **Read-only over a finished run.** Never re-run an agent, re-open a stage, or fix something the
  retro found. Report it and stop.
- Grade the *run*, not the diff. A code defect belongs to `/pr-self-review`; it appears here only if
  the *process* let it through — no reviewer covered that package, say.
- When proposing a candidate, match the existing entry format and routing from
  [engineering-insights](../engineering-insights/SKILL.md):

      ### <the claim, as a statement>
      **Symptom:** what was seen first.
      **Rule:** what to do instead. `<anchor>`
      _<ISO date>_

  A finding about the agent chain itself is a **root** `insights.md` finding — it is tooling, not
  package behavior.
