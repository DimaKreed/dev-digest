import { z } from 'zod';
import { ConventionCategory, type ConventionStatus } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import { MAX_CANDIDATES } from './constants.js';

/**
 * Domain types + the model-facing contract for the conventions module.
 *
 * Row types live HERE, not in `repository.ts`, for two reasons:
 *  - `helpers.ts` is ring 0 and may not import `src/db/` at all (arch rule
 *    `c5-pure-helpers`) — and dependency-cruiser counts an `import type` as a
 *    real edge, so routing the row type "around" the rule via `db/rows.ts`
 *    fails too;
 *  - importing it from `repository.ts` instead would close the cycle
 *    helpers → repository → helpers (`no-circular`).
 *
 * Both `helpers.ts` and `repository.ts` depend inward on this file. See
 * server/insights.md, "Declaring Drizzle row types in repository.ts…".
 */
export type { ConventionRow };

/**
 * The fields a suppression key is derived from. Satisfied by both a persisted
 * `ConventionRow` and a fresh `InsertConvention`, so `rescanForRepo` can key
 * existing and incoming candidates through one pure function. Declared here
 * rather than in `helpers.ts` so ring 0 and the repository both depend inward
 * on this file instead of on each other.
 */
export interface SuppressionInput {
  rule: string;
  evidencePath: string | null;
  evidenceStartLine: number | null;
}

/** Just enough of a repo row to address the clone and label the skill. */
export interface RepoInfo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

/** A verified candidate on its way into the table. */
export interface InsertConvention {
  rule: string;
  category: ConventionCategory;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceFiles: string[];
  occurrences: number;
  confidence: number;
}

export interface UpdateConvention {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

/**
 * Repository port (C3) — the persistence surface `ConventionsService` depends
 * on. `ConventionsRepository` implements it; a test substitutes it through
 * `ContainerOverrides.conventions` instead of casting into a private field.
 *
 * Deliberately narrower than the class (H11): `getById` is repository-internal
 * (only `update` calls it), so it is not on the port. Add a method here only
 * when the SERVICE calls it.
 */
export interface ConventionsRepositoryPort {
  /** Reads the `repos` table — this module never imports `modules/repos`. */
  getRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined>;
  /** Raw `settings.feature_models` value; the service validates it. */
  featureModelsSetting(workspaceId: string): Promise<unknown>;
  listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]>;
  listByIds(workspaceId: string, repoId: string, ids: string[]): Promise<ConventionRow[]>;
  update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined>;
  rescanForRepo(
    workspaceId: string,
    repoId: string,
    values: InsertConvention[],
    keysOf: (c: SuppressionInput) => string[],
  ): Promise<{ rows: ConventionRow[]; suppressed: number }>;
  setSkillId(
    workspaceId: string,
    repoId: string,
    ids: string[],
    skillId: string,
  ): Promise<number>;
}

/**
 * The two repo-intel reads this module makes, declared HERE rather than taken
 * from `modules/repo-intel/types.ts`: importing a sibling slice's file trips the
 * `no-cross-module` arch rule, and the service only ever needs these two.
 * `RepoIntel` satisfies it structurally, so the container passes its facade
 * straight in.
 */
export interface ConventionsRepoIntelPort {
  /** Top-N source paths by rank; `[]` when repo-intel is off or unindexed. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;
  getRepoMap(
    repoId: string,
    tokenBudget?: number,
  ): Promise<{ text: string; degraded?: boolean }>;
}

/** Schema name passed to `completeStructured` (and keyed by test fixtures). */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/**
 * What the extractor model is asked to emit. NOT a shared contract: none of it
 * is trusted and none of it is returned to the client as-is — every evidence
 * item is re-checked against the real file before it becomes a
 * `ConventionCandidate`.
 *
 * `evidence.min(2)` is the load-bearing part: a rule the model cannot cite in
 * two places is not a house convention, and the server enforces the same floor
 * again on the VERIFIED evidence (`MIN_DISTINCT_FILES`).
 *
 * Evidence is an ANCHOR LINE, not a quoted block. A model writes its answer one
 * token at a time, so making it retype code we already have on disk was the
 * single largest cost in a scan (~7k output tokens ⇒ ~2 minutes). One line is
 * enough to prove it read the file — the anchor is still matched against the
 * real source, and a rule whose anchor cannot be found is discarded — while the
 * server reads the surrounding lines itself.
 */
export const ConventionExtraction = z.object({
  candidates: z
    .array(
      z.object({
        rule: z.string().min(10).max(240),
        category: ConventionCategory,
        confidence: z.number().min(0).max(1),
        evidence: z
          .array(
            z.object({
              path: z.string(),
              /** ONE distinctive line, copied verbatim. Verified. */
              anchor: z.string().min(3).max(200),
              start_line: z.number().int().positive(),
              end_line: z.number().int().positive(),
            }),
          )
          .min(2)
          .max(4),
      }),
    )
    .max(MAX_CANDIDATES),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;
