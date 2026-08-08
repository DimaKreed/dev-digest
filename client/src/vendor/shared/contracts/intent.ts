import { z } from 'zod';

/**
 * Intent Layer contracts.
 *
 * Two schemas on purpose:
 *  - `IntentClassification` is the LLM output shape. Every field is REQUIRED
 *    because it is compiled to a strict `json_schema` response format, which
 *    rejects optional keys.
 *  - `PrIntentDetail` is the API read shape. Every column added by the
 *    `pr_intent` ALTER is `nullish`, because rows written before that migration
 *    have no such value.
 *
 * The base `Intent` (intent / in_scope / out_of_scope) lives in `brief.ts` and
 * is deliberately left untouched — it is shared with the (unbuilt) PR Brief.
 */

/** Where one piece of classifier input came from. `ref` is a path, a URL or a label. */
export const IntentSource = z.object({
  kind: z.enum(['pr_title', 'pr_body', 'file_list', 'github_issue', 'repo_file']),
  ref: z.string(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * Structured output of the cheap pre-review classifier. All fields required —
 * strict `json_schema` does not permit optional properties.
 */
export const IntentClassification = z.object({
  intent: z.string().describe('One sentence: what this PR is trying to accomplish.'),
  in_scope: z
    .array(z.string())
    .describe('Concerns the PR deliberately takes on. Short noun phrases.'),
  out_of_scope: z
    .array(z.string())
    .describe(
      'Concerns the author deliberately excluded. Only list something stated or clearly implied by the PR text — never invent an exclusion.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'How well the available context supported this classification. Lower it for every source that was missing or unreachable.',
    ),
  sources: z.array(IntentSource).describe('Every input actually used, in the order read.'),
  missing_context: z
    .array(z.string())
    .describe(
      'Anything referenced but not reachable — a linked issue that could not be fetched, an empty PR description, a plan file that does not exist. One short line each.',
    ),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

/** Whether a stored classification is available for this PR right now. */
export const PrIntentStatus = z.enum(['ready', 'deriving', 'absent']);
export type PrIntentStatus = z.infer<typeof PrIntentStatus>;

/**
 * `GET|POST /pulls/:id/intent` response. Tolerant on purpose: the columns below
 * were added by a later migration, so a pre-existing `pr_intent` row has none of
 * them. `stale` is derived SERVER-side (`row.head_sha !== pull.head_sha`) so the
 * client needs no comparison logic of its own.
 */
export const PrIntentDetail = z.object({
  pr_id: z.string(),
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  head_sha: z.string().nullish(),
  model: z.string().nullish(),
  confidence: z.number().nullish(),
  sources: z.array(IntentSource).nullish(),
  missing_context: z.array(z.string()).nullish(),
  created_at: z.string().nullish(),
  stale: z.boolean(),
  status: PrIntentStatus,
});
export type PrIntentDetail = z.infer<typeof PrIntentDetail>;
