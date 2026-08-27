# Non-functional requirements — what this repo fixes, and what it does not

The `## Non-functional requirements` section is where a spec author is most likely to invent
something. Four of the five areas below have **no convention in this repository**, so a
confident-sounding NFR is usually fabrication dressed as a requirement — and it will be inherited
by `test-writer` as an `AC-NN` to assert and by `plan-verifier` as a row to verify.

The rule for this section:

> **A convention that exists becomes a criterion. A convention that does not exist becomes an
> open question with a proposed default — never a criterion.**

Both outcomes are useful. An open question here is the spec working correctly: it puts a real gap
in front of the person who can decide it, instead of hiding it behind a number nobody agreed to.

Work the five areas in order and say, for each, which of the two outcomes you reached. An NFR
section that skipped an area silently is indistinguishable from one where the area did not apply.

## 1. Internationalisation — convention exists, use it

The one area with a real, enforced convention.

- Every user-facing string comes from a next-intl namespace; **no inline literals**
  (`client/CLAUDE.md:37`).
- Messages live in `client/messages/en/<namespace>.json` at the package root, not under `src/`.
- Constants hold an i18n **key**, not text — the `labelKey` pattern
  (`.claude/skills/frontend-ui-architecture/references/logic-and-constants.md`).
- Design-system components stay i18n-free; the translated wrapper lives in `src/components/`
  (`frontend-ui-architecture/SKILL.md:130-132`).
- Namespace keys in the eight scaffolding namespaces cannot be removed
  (`pr-self-review/invariants.md:19`).

So: **write the criterion.** `The system shall render every user-facing string from the <ns>
next-intl namespace.` Name the namespace, and name new keys you are requiring.

**The gap:** only `en` exists. No plural rules, no date or number formatting convention, no RTL,
no locale negotiation. If your feature needs any of those, that is an open question, not a
criterion.

## 2. Accessibility — almost no convention

The only source in the repo is five rules in `.claude/skills/react-best-practices/SKILL.md:145-151`:

- `aria-label` on icon-only buttons.
- Error messages linked to fields with `aria-describedby` and `aria-invalid`.
- `aria-live="polite"` for dynamic updates — search results, notifications, toasts.
- Focus trapped in modals, with both an Escape key and a visible Close button.
- Route changes announced; SPA navigation is silent by default.

Those five are specific enough to become criteria when your feature has the matching surface, and
you should write them as criteria when it does.

**What does not exist anywhere:** a WCAG conformance level, a keyboard-navigation policy, colour
contrast requirements, reduced-motion handling, or a screen-reader support target. Nothing in
`client/CLAUDE.md` or `client/src/vendor/ui/README.md` covers accessibility at all.

Do not invent a level. `The system shall meet WCAG 2.2 AA` is not a repo convention — it is a
decision nobody has made. It goes to `## Open questions` as a proposed default so the user can
adopt it in one word.

Two known open defects worth reading rather than re-deriving: `client/insights.md` records a hover
affordance with no accessible name and no queryable role, and `e2e/insights.md` records
accessible-name matching semantics as still unresolved. The test side does have a convention — RTL
queries are role-first with `getByTestId` as the last resort, and `e2e/CLAUDE.md:38` prefers
`role` plus accessible name over text matching — so a criterion phrased around an accessible role
is at least testable today.

## 3. Performance — no budget exists

There is **no** stated performance budget in this repository: no p95 or p99 target, no bundle-size
limit, no Lighthouse threshold, no perf gate in CI.

Two real constraints you may cite, because they are facts rather than targets:

- **The Postgres connection pool is small, max ~10** (`docs/agent-prompts/performance-reviewer.md:10-12`).
  A criterion requiring fan-out across many concurrent queries is constrained by this.
- **`p-queue` controls fan-out to external services**, and octokit is rate-limited (same file).

Two numbers that look like budgets and are not:

- The 120 s timeouts in server integration tests are **testcontainers startup budget, not a
  hang** and not a product SLA (`server/CLAUDE.md:66-67`).
- `docs/agent-prompts/performance-reviewer.md` is a *reviewer prompt* — heuristics for reading a
  diff, not thresholds the system promises.

So: a latency or throughput criterion is an open question with a proposed default, every time,
unless the user states the number. What you *can* write as a criterion is a shape rather than a
threshold — and this is usually the better requirement anyway:

> `WHEN a repository exceeds the indexing threshold, the system shall build the overview from
> deterministic facts only, without reading every file in full.`

That is verifiable without agreeing on a millisecond figure.

## 4. Observability — thin, and mostly configuration trivia

What exists: `server/src/platform/` holds `run-logger`; `LOG_LEVEL` is empty in `.env.example` and
must stay tolerated; `NODE_ENV=test` silences logs and disables the global rate limit
(`server/CLAUDE.md:69-72`).

What does not exist: a list of events that must be logged, a redaction policy for secrets in logs,
a correlation or request-id rule, and any metrics or tracing convention. `docs/` has nothing on
this.

`.claude/skills/security/SKILL.md:148-155` does carry an explicit "log these / never log these"
list, and it is the only such list in the repo — but that skill is written for **Express +
Mongoose + JWT**, and this stack is **Fastify 5 + Drizzle/Postgres 16 + Next 15**. Treat it as a
prompt for what to ask about, never as this repo's policy. Quoting its specifics would specify a
system that does not exist here.

One behavior worth a criterion because it is genuinely surprising: **grounding drops ungrounded
findings silently** (`server/CLAUDE.md:73-74`). If your feature reports counts, a criterion that
the drop is *observable* is a real requirement, not gold-plating.

## 5. Error copy and empty states — a de facto pattern, undocumented

`client/messages/en/common.json` is the pattern nobody wrote down:

```json
"states": { "loading": "Loading…", "empty": "Nothing here yet", "error": "Something went wrong" }
"repoNotFound": { "title": "…", "body": "…", "cta": "Add repository" }
```

Two things to take from it:

- The three shared state strings under `common.states` already exist. A criterion about a loading,
  empty or error state should say whether it uses those or needs its own — and needing its own is
  fine, it just has to be stated so the keys get created.
- `repoNotFound.{title, body, cta}` is the **shape** of a good empty state here: a short title,
  a body that says why and what changed, and a call to action. Follow it for a new empty state.

There is no tone or voice guide and no documented error-envelope shape. Server-side, the only
stated rule is schema-first 422 (`server/CLAUDE.md:52-53`). So specific copy is an open question
unless the user gives it — but the *structure* above is a defensible default to propose.

## Where these land in the spec

| Outcome | Section |
|---|---|
| A convention exists and your feature touches it | `## Non-functional requirements`, as an `AC-NN` in an EARS pattern |
| No convention, and the feature needs one | `## Open questions`, numbered, with a proposed default and who decides |
| No convention, and the feature does not need one | Say so in your report; do not write a placeholder criterion |

A non-functional requirement with no `AC-NN` id cannot appear in `plan-verifier`'s traceability
matrix, so it will never be checked. Either give it an id or move it to `## Open questions` —
there is no third option that survives to verification.
