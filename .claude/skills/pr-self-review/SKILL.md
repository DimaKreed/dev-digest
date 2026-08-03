---
name: pr-self-review
description: Reviews every open local change before a pull request is opened, routing each changed file to the skills that govern it (UI skills onto UI files, onion and data skills onto server files) and blocking PR creation on any CRITICAL finding. Use before running gh pr create, gh pr ready or gh pr merge, after finishing a feature and before publishing it, and whenever the pr-gate hook denies a command. Also use when the user invokes /pr-self-review or asks to self-review, pre-review, or check local changes before opening a PR.
allowed-tools: Bash, Read, Glob, Grep, Agent, Write
argument-hint: "[optional: dismiss <finding-id> <reason>, or a path to narrow the review]"
---

# PR self review

Reviews the changes that a PR *would* contain, before it exists. The reviewing is model work; the
blocking is not — [pr-gate.ps1](../../hooks/pr-gate.ps1) reads this skill's report and denies
`gh pr create`, `gh pr ready` and `gh pr merge` while a CRITICAL stands.

This is not a second `/code-review`. That skill reviews a diff generically. This one replays **the
repo's own skills** against the files each governs, adds the contract checks no generic reviewer
knows, and produces a machine-readable verdict.

## The gate

The policy is the repo's own `CiFailOn: 'critical'` — block iff ≥1 CRITICAL. Mirror
`reviewer-core`'s semantics rather than inventing a parallel notion:

| Quantity | Source of truth |
|---|---|
| does this block | `gateTriggered(findings, 'critical')`, `countBlockers` — [to-review.ts](../../../reviewer-core/src/output/to-review.ts) |
| `verdict` | 0 findings ⇒ `approve`; gate tripped ⇒ `request_changes`; else `comment`. The model's own opinion of the verdict is **ignored**, exactly as `to-review.ts:156-161` ignores it |
| `score` | `scoreFromFindings` — `CRITICAL 35 / WARNING 12 / SUGGESTION 3` off 100 |
| `severity`, `category`, the `Finding` shape | [findings.ts](../../../server/src/vendor/shared/contracts/findings.ts) — `CRITICAL \| WARNING \| SUGGESTION`, never another scale |

## Step 1 — scope

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/hooks/pr-review-scope.ps1 -Json
```

**Never compute the fingerprint any other way.** That script is shared with the hook precisely so
the two cannot disagree; the reasons are in its header. Take `fingerprint`, `baseSha`, `baseRef`,
`excludes`, `files` and `algo` from its output verbatim into the report.

Then collect the diff for review — the union of committed-since-base, working tree, and untracked:

```bash
git diff --name-status <baseSha> HEAD
git diff --name-status HEAD
git ls-files --others --exclude-standard
git diff -U0 <baseSha> -- <file>    # per file, for the grounding line index
```

Not reviewed: `server/clones/**`, `**/node_modules/**`, lockfiles, and
`**/migrations/meta/*.json` (generated — flag a hand-edit, never review the content).

State the scope in one line before reviewing: base, branch, file count, lanes about to run. If
`onBaseBranch` is true there is no branch yet — review anyway, and say that `gh pr create` will
need `git switch -c <branch>` first. If `baseSource` is `no-merge-base`, or `baseDrift` is true,
record a WARNING that the scope may not match what GitHub will show. Neither is a reason to stop.

## Step 2 — route

Match every changed path against the table in [routing.md](routing.md). A lane runs **only if it
matched at least one file**; `invariants` always runs. Report which lanes were skipped and why —
silent coverage gaps read as clean.

## Step 3 — fan out, one subagent per lane, in parallel

Give each subagent exactly: the skills to load, **only its own slice of the diff**, the changed-file
list, the severity policy from Step 5, the do-not-flag list from [routing.md](routing.md), and the
`insights.md` of the module it reviews. Those files already record real traps — a Zod field read
back out of `jsonb` must be `.nullish()`; the severity tally is computed twice in two languages —
so they are review rules that cost nothing to author.

Reviewers are **read-only**. They surface findings and never apply fixes.

Each returns `Finding[]` plus a `status`. A lane that fails or times out is recorded with that
status and **the report is not a pass** — the hook denies on any lane whose status is not `ok`.

## Step 4 — mechanical checks

Deterministic, no model judgement, and the findings most likely to actually fire. Full list with
commands in [invariants.md](invariants.md). The two that carry the most weight:

- **`cd server && pnpm arch`** — dependency-cruiser with `--ignore-known`, so it exits non-zero
  only on a **new** onion violation. Any output is CRITICAL. Never regenerate
  `.dependency-cruiser-known-violations.json` to silence it; the baseline only shrinks.
- **`pnpm typecheck`** (pnpm in `client/`+`server/`, **npm** in `reviewer-core/`+`e2e/`), scoped to
  the packages the diff touches. This is the "does not build" arm of the allowlist. Missing
  `node_modules` ⇒ record a WARNING that it was **skipped** — never a silent pass.

Record typecheck as both `checks.typecheck.status` and a CRITICAL finding, so the gate holds even
if one is forgotten.

## Step 5 — merge pipeline

Order matters; each stage stops a specific failure.

1. **Ground.** Drop any finding whose `start_line`–`end_line` does not intersect a real hunk on the
   new side, mirroring [grounding.ts](../../../reviewer-core/src/grounding.ts). Exempt the
   `FULL_FILE_KINDS` (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) — those need only the
   file to be in the diff. Without this, touching a legacy file inherits its debt and blocks the PR.
2. **Dedupe** by file, overlapping line range and normalized title, keeping the highest severity and
   confidence. Lanes overlap heavily; undeduped findings inflate the blocker count.
3. **Cap severity.** CRITICAL is a **closed list** — nothing is promoted into it, however a source
   skill labels its own rules (`react-best-practices` tags rules CRITICAL/HIGH/MEDIUM; those are
   *its* labels, not this vocabulary):
   1. exploitable security defect — authz bypass, injection, secret or PII leak
   2. data loss, or an irreversible migration
   3. a broken repo contract — any CRITICAL row in [invariants.md](invariants.md), including a new
      `pnpm arch` violation and onion `C1`–`C6`
   4. code that does not typecheck or build

   Everything else a skill states as must/never caps at **WARNING**. Style, naming and idiom are
   **SUGGESTION**. Every CRITICAL records a `blocking[].reason` naming which of the four it is.
4. **Verify each candidate CRITICAL adversarially.** One subagent per finding, prompted to *refute*
   it; only survivors block. Any CRITICAL under **0.8** confidence becomes a WARNING titled
   "unverified — ". Only CRITICALs block, so this is cheap, and one false block is what gets a gate
   switched off for good.
5. **Apply dismissals** (below).
6. **Compute** `counts`, `blocking[]`, `verdict` and `score` per the table at the top.

## Step 6 — write the report

`.devdigest/cache/pr-self-review/report.json`, plus `report.md` for humans and
`groups/<lane>.json` for debugging. That directory is already gitignored, and it must stay
gitignored: a report visible to `git ls-files --others` changes the fingerprint that authorises it,
and the gate nullifies itself the instant it writes.

Shape — the starred fields are what the hook reads, so they are not optional:

```jsonc
{ "schemaVersion": 1,                   // *
  "generatedAt": "<ISO-8601 UTC>",      // * 24 h limit
  "scope": { "algo": "...", "fingerprint": "...", "excludes": [...],   // * verbatim from Step 1
             "baseRef": "...", "baseSha": "...", "files": [...] },     // * files[] names the drift
  "counts": { "CRITICAL": 0, "WARNING": 4, "SUGGESTION": 7 },          // * plain integers
  "verdict": "approve", "score": 88, "summary": "...",
  "groups": [ { "lane": "ui-react", "skills": ["react-best-practices"],
                "files": 12, "status": "ok", "findingIds": [] } ],     // * every status must be ok
  "checks": { "typecheck": { "status": "pass", "packages": {} },       // *
              "arch": { "status": "pass", "newViolations": 0 },
              "tests": { "status": "not-run" } },
  "findings": [ /* Finding[] per findings.ts */ ],
  "blocking": [ /* {id,severity,reason,file,line,title} per CRITICAL */ ] }
```

Then print a short human summary: verdict, score, counts, each CRITICAL as
`file:line — title`, and the lanes that ran. If nothing was found, say so plainly — an invented
finding is worse than an empty lane.

## Dismissals

`/pr-self-review dismiss <finding-id> <reason>` records the finding in
`.devdigest/cache/pr-self-review/dismissed.json`, keyed by file plus a hash of the flagged lines,
with the reason and the date. A dismissal **expires when those lines change**, so it cannot silently
outlive the code it excused. Dismissed findings stay in `findings[]`, marked, and drop out of
`counts.CRITICAL` — mirroring the repo's own `accept | dismiss` vocabulary.

Never dismiss on your own initiative. A dismissal is the user's judgement, recorded in their words.

## Limits — say these out loud when reporting a pass

- A `PreToolUse` hook constrains **the agent, not a human**. Anyone can run `gh pr create` in their
  own terminal, or delete the report. The honest claim is "the agent cannot autonomously open a
  PR", not "no bad PR can be opened". Real enforcement is branch protection plus a required check.
- The report is **forgeable** by anything that can write the file and run the scope script. It is a
  quality gate, not a security control.
- **Severity is model judgement.** The gate mechanises "CRITICAL ⇒ stop", not "is this CRITICAL".
- A pass means "typecheck passed, `pnpm arch` clean, no CRITICAL survived verification". It does
  **not** mean the tests pass — tests are not run. Say so.
- Gitignored content (`.env`, `server/clones/**`) is outside the fingerprint and unreviewed.
- Windows/PowerShell only today; see [../../hooks/README.md](../../hooks/README.md).
