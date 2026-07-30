# Insights — client

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

### `onOpenChange={(open) => setX(open ? me : null)}` breaks when two hover panels sit side by side
**Symptom:** three severity chips in a PR row, each a `HoverCard` reporting open/closed into one
piece of row state that gates the findings fetch. Sliding from the CRITICAL chip to the WARNING one
left the WARNING panel showing an empty list. The timers interleave: leaving A schedules its close
at +150ms while entering B opens at +120ms, so A's `onOpenChange(false)` lands *after* B's
`onOpenChange(true)` and wipes it. Nothing errors; the panel is just blank.
**Rule:** a shared "which one is open" state must only be cleared by the trigger that owns it —
`setPeek((cur) => (open ? sev : cur === sev ? null : cur))`. Better still, don't select panel
*content* from that shared state at all: give each panel its own filter (`liveFindings.filter(f =>
f.severity === sev)`) and let the shared state gate only the fetch, since both panels are briefly
mounted during the hand-off. See `src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`.
_2026-07-30_

## Codebase Patterns

### Run-level data reaches the review-run header by joining on `run_id` in FindingsTab — not by extending `ReviewRecord`
**Symptom:** the REVIEW RUNS accordion header needed the run's cost, but `ReviewRecord`
(`src/vendor/shared/contracts/review-api.ts`) carries no tokens/cost/duration at all, so extending
that contract *and* the server's reviews route looked unavoidable — and would have meant editing
both diverged `vendor/shared` copies.
**Rule:** `FindingsTab` already receives both `prRuns: RunSummary[]` (which does carry run usage)
and `runs: ReviewRecord[]`, and `ReviewRecord.run_id` is already used there for scroll-targeting.
Build a `Map<run_id, …>` from `prRuns` and pass the value down as a prop — zero contract or server
change. See `costByRunId` in
`src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`.
_2026-07-30_

### The Agent runs tab is the PR detail page's only findings surface — Overview and Files changed render none
**Symptom:** "filter findings across the PR page" reads as three surfaces to touch, and
`messages/en/prReview.json` even carries a `smartDiff.findingLines` key. But `OverviewTab`
renders only `prBody` behind a `SectionLabel`
(`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:11-22`), and
grepping `finding` across `src/components/diff-viewer/` returns **nothing** — `DiffTab` feeds
`DiffViewer` GitHub review *comments* via `usePrComments`, never findings.
**Rule:** scope any findings-wide feature to `FindingsTab` and below. Putting one on Overview
means building a new list component; putting one in the diff means teaching `DiffViewer` to
anchor a finding's `file` + `start_line`/`end_line` to diff rows. Each is its own feature, not
a prop you can thread through.
_2026-07-30_

### Any PR-level findings tally must collapse `reviews` to the latest run per agent first
**Symptom:** `usePrReviews` returns one `ReviewRecord` per run, newest-first, each with its own
`findings[]` — so the obvious `runs.flatMap((r) => r.findings)` counts a re-run's findings
twice. The "Agent runs" tab badge (`findingsCount` in
`src/app/repos/[repoId]/pulls/[number]/page.tsx`) still does exactly this and inflates after
any re-run.
**Rule:** dedupe on `agent_id` before tallying — the API is newest-first, so first-seen wins —
and drop `dismissed_at != null` so the number matches the blockers count at
`_components/ReviewRunAccordion/ReviewRunAccordion.tsx:66`. See `latestRunPerAgent` +
`countBySeverity` in `_components/SeverityFilterBar/helpers.ts`. `rollupSeverities`
(`server/src/modules/pulls/status.ts:16`) computes the same tally but is server-side and not
importable from the client.
_2026-07-30_

**Update:** those helpers now live in **`src/lib/severity.ts`** (with `SEVERITY_LEVELS`,
`parseSeverity`, `isLiveFinding`, `runMatches`) — they moved out of the detail route's
`_components` once the PR list needed them too, since one route's `_components` is not an
import target for another route. `src/lib/severity.test.ts` came with them. _2026-07-30_

### A PR list row navigates from `onClick` on a `<div>`, not a `<Link>` — nested controls need `stopPropagation`
**Symptom:** adding clickable severity chips inside the row looked like an anchor-nesting problem.
It isn't — `PRRow` is a plain `<div onClick={() => router.push(...)}>`
(`src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:22-27`), so a nested `<button>` is valid
HTML. The real hazard is quieter: without `e.stopPropagation()` the row's handler fires too, and its
`router.push` to the unfiltered PR URL lands *after* the chip's, so the query params vanish with no
error anywhere.
**Rule:** any interactive element added inside a PR row must `stopPropagation` first — same idiom as
the delete button at `_components/ReviewRunAccordion/ReviewRunAccordion.tsx:124`. Assert it by
mocking `useRouter` and checking `push` was called exactly **once**; see the last two cases in
`_components/PRRow/PRRow.test.tsx`.
_2026-07-30_

### An anchored panel must be `position: fixed` here — `absolute` gets clipped by the PR table card
**Symptom:** the obvious move for a findings peek panel is to copy `Dropdown`
(`src/vendor/ui/kit/Dropdown.tsx:88`), which is `position: absolute; top: calc(100% + 6px)` inside a
`position: relative` wrapper. Inside a PR list row that panel is cut off — `s.tableCard` in
`src/app/repos/[repoId]/pulls/styles.ts` sets `overflow: "hidden"` to clip the rounded corners.
There is no portal anywhere in the client and no `@floating-ui`/radix to fall back on.
**Rule:** anchor with `position: fixed` and coordinates from the trigger's
`getBoundingClientRect()`. Fixed descendants are not clipped by an ancestor's `overflow: hidden`
(only by one that establishes a containing block — a transform/filter/`will-change`, none of which
this app uses), so no portal is needed. It also buys viewport flipping, which `Dropdown` can't do
for rows near the bottom of a long table. See `src/vendor/ui/kit/HoverCard.tsx`.
_2026-07-30_

## Tool & Library Notes

### Anything added to the Showcase gallery must render with **no** providers
**Symptom:** the design-system rule is that a new `@devdigest/ui` component goes into
`src/components/showcase/Showcase.tsx` or CI loses its render gate — but the only thing that renders
that gallery is `src/test/smoke.test.tsx`, which mounts it wrapped in **neither**
`NextIntlClientProvider` nor `QueryClientProvider`. A kit component calling `useTranslations` or a
query hook throws there, and the failure reads as a smoke-test regression rather than a missing
wrapper. (There is also no `/showcase` route — `Gallery` has no other consumer.)
**Rule:** keep kit components dumb — no i18n, no data. Put the translated, data-fetching wrapper in
`src/components/<Name>/` instead and leave it out of the gallery. `HoverCard` is deliberately a bare
container for this reason; `FindingsHoverList` is the one that calls `useTranslations`.
_2026-07-30_

## Recurring Errors & Fixes

### `TS2307: Cannot find module '../../../../../../messages/en/prReview.json'` in a new component test
**Symptom:** vitest has no alias for `messages/`, so every client test deep-imports the i18n JSON by
relative path — and the depth differs per route nesting. Copying the import line from a
`pulls/[number]/_components/X/` test (7 `..`) into a `pulls/_components/X/` test (6 `..`) typechecks
nowhere and vitest resolves nothing. `pnpm test` alone won't always surface it clearly; `pnpm
typecheck` names the file and the bad specifier.
**Rule:** count segments from the test file to the `client/` package root, don't copy the path.
Existing depths: `src/components/*` ⇒ 3 `..`,
`src/app/repos/[repoId]/pulls/_components/*` ⇒ 7 `..`,
`src/app/repos/[repoId]/pulls/[number]/_components/*` ⇒ 8 `..`. If this recurs, the fix is an
alias in **both** `tsconfig.json` and `vitest.config.ts` (the latter doesn't read tsconfig paths).
_2026-07-30_

## Session Notes

## Open Questions
