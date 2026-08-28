import type { Provider } from '@devdigest/shared';

/**
 * Brief module constants. Pure values only — no I/O and no reach into the
 * persistence or adapter layers (arch rule `c5-pure-helpers` covers this file
 * as well as `helpers.ts`).
 */

/**
 * The hard ceiling on the assembled model input, counted with the server-side
 * tokenizer before the call is made (AC-04).
 *
 * Counted against whatever the tokenizer can do: `TiktokenTokenizer` degrades
 * permanently to `ceil(chars / 4)` when its BPE ranks fail to load, so this is
 * enforced against an estimate on that path. The spec says so explicitly; the
 * cap is a budget, not a provider limit.
 */
export const BRIEF_INPUT_TOKEN_CAP = 8_000;

/**
 * The fixed order inputs are dropped in when the assembled input exceeds the
 * cap (AC-05). This array IS the order — `fitToBudget` walks it and the names
 * it returns are the names recorded in the stored document (AC-06).
 *
 * The derived intent and the diff stats are absent from it on purpose: they are
 * never dropped, whatever the budget.
 */
export const DROP_ORDER = [
  'project_context',
  'issue_body',
  'file_list_tail',
  'blast_downstream',
] as const;
export type BriefDroppableInput = (typeof DROP_ORDER)[number];

/** How many changed-file paths survive the `file_list_tail` drop. */
export const FILE_LIST_HEAD_N = 25;

/**
 * Per-input character caps applied at ASSEMBLY, before any budget decision.
 *
 * These are not drops and are never recorded as such: they bound one
 * pathological input (a 500 KB PR description, an issue body pasted from a log)
 * so that the four ordered drops operate on a payload of a sane size. The
 * reviewer-core prompt builder caps the PR description the same way.
 */
export const MAX_DESCRIPTION_CHARS = 4_000;
export const MAX_ISSUE_CHARS = 4_000;
export const MAX_CONTEXT_DOC_CHARS = 8_000;

/** How many linked issues are followed at most. */
export const MAX_LINKED_ISSUES = 3;

/** How many attached project-context documents are carried at most. */
export const MAX_CONTEXT_DOCS = 5;

/** Cap on the changed symbols and endpoints named in the blast paragraph. */
export const MAX_BLAST_ITEMS = 12;

/**
 * Timeout for the single generation call. One structured completion over a
 * fact block, not over a whole repository — so the blast history-notes number
 * is the right neighbour to copy, not the onboarding generator's five minutes.
 * Keep equal to `NOTES_TIMEOUT_MS` in `modules/blast/notes-service.ts`.
 */
export const BRIEF_TIMEOUT_MS = 30_000;

/** Provider-level retries for that one call. It is still ONE call (AC-01). */
export const BRIEF_MAX_RETRIES = 1;

/**
 * Which stored key a provider's availability is decided by.
 *
 * Restated here rather than imported from the settings slice: reaching into
 * another slice's folder trips the `no-cross-module` arch rule even for a bare
 * constant. Keep equal to the map of the same name in
 * `modules/onboarding/constants.ts` and under `modules/settings`. Only key
 * PRESENCE is ever read through this — no value reaches a response.
 */
export const SECRET_KEY_BY_PROVIDER: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/**
 * The per-feature model registry id this brief resolves through.
 *
 * Restated as a constant rather than imported from `modules/settings` for the
 * same `no-cross-module` reason. It is deliberately SHARED with blast
 * history-notes (`modules/blast/notes-service.ts`): both features resolve
 * `feature_models.risk_brief`, so changing one changes the other. Un-sharing it
 * would mean a new registry id in both `contracts/platform.ts` copies plus a
 * settings-UI change, and no criterion needs it.
 */
export const BRIEF_FEATURE_MODEL_ID = 'risk_brief';
