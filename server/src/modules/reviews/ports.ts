/**
 * Row and domain types for the reviews module.
 *
 * They live here rather than in `repository.ts` because `helpers.ts` is a pure
 * ring-0 file: importing a type from `repository.ts` creates a
 * helpers → repository → helpers cycle, and importing one from `db/rows.ts`
 * directly trips `c5-pure-helpers` (dependency-cruiser counts a type-only
 * import as an edge). `ports.ts` re-exports inward from `db/rows.ts` and both
 * sides depend on it.
 */
import type { IntentSource } from '@devdigest/shared';

export type { FindingRow, PullRow, PrIntentRow } from '../../db/rows.js';

/**
 * The three PR fields the intent classifier actually reads.
 *
 * Declared narrowly rather than taking `PullRow`, because `intent.ts` is a ring-2
 * use case and H8 keeps Drizzle row aliases below ring 2. `pnpm arch` cannot catch
 * this — the `h8-no-db-handle-above-repository` selector only matches `db/client`,
 * so it sees the `Db` handle and never the row types. Callers hold a `PullRow` and
 * structurally satisfy this, so mapping is free.
 */
export interface IntentPull {
  number: number;
  title: string;
  body: string | null;
}

/**
 * A stored `pr_intent` row in domain vocabulary (snake_case, contract-shaped).
 * Everything below `out_of_scope` was added by migration `0014`, so a row
 * written before it has `null` for all of them.
 */
export interface StoredIntent {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  head_sha: string | null;
  model: string | null;
  confidence: number | null;
  sources: IntentSource[] | null;
  missing_context: string[] | null;
  created_at: string | null;
}

/** What `upsertIntent` writes. `created_at` is set by the column default. */
export type IntentUpsert = Omit<StoredIntent, 'created_at'>;

/**
 * A merged PR that touched some of the same files as the PR under review.
 *
 * `mergedAt` is `pull_requests.updated_at`: there is no merge timestamp column,
 * and `status = 'merged'` is the only merge signal the import writes. Nullable
 * because that column is.
 */
export interface PriorPrRow {
  number: number;
  title: string;
  author: string;
  mergedAt: Date | null;
  /** The subset of the queried paths this PR also touched. */
  filesOverlap: string[];
}

/**
 * One project-context attachment as the run reads it. `skillId === null` is the
 * agent's own; anything else names the linked skill it came from.
 */
export interface ContextAttachmentSource {
  skillId: string | null;
  path: string;
  order: number;
}

/**
 * The ONE project-context read this module makes, declared HERE rather than
 * imported from `modules/context/ports.ts`: reaching into a sibling slice trips
 * `no-cross-module`, and the executor never needs more than this. The
 * container's `ContextRepository` satisfies it structurally — no `implements`,
 * no adapter, no mapper — which is the same shape `SmartDiffReads` uses over
 * `reviewRepo`.
 */
export interface ContextReads {
  listForAgentAndSkills(
    agentId: string,
    skillIds: readonly string[],
    repoId: string,
  ): Promise<ContextAttachmentSource[]>;
}
