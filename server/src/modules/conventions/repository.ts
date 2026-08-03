import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from './ports.js';

/**
 * Conventions data-access. The ONLY place that touches `conventions`.
 *
 * It also READS two tables it does not own — `repos` (to resolve the clone ref
 * and display name) and `settings` (the workspace's per-feature model choice).
 * That is table access, not a cross-module import: `modules/conventions` never
 * imports `modules/repos` or `modules/settings` (arch rule `no-cross-module`),
 * and it writes to neither table. Same precedent as `modules/skills`, which
 * reads `agent_skills` for its Stats rollup.
 */

export type { ConventionRow };

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

export class ConventionsRepository {
  constructor(private db: Db) {}

  // ---- reads on other domains' tables --------------------------------------

  async getRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The workspace's raw `feature_models` settings value, unparsed — the service
   * validates it through the shared `FeatureModelChoice` schema and falls back
   * to the registry default.
   */
  async featureModelsSetting(workspaceId: string): Promise<unknown> {
    const [row] = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    return row?.value;
  }

  // ---- conventions ---------------------------------------------------------

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.rule));
  }

  async listByIds(
    workspaceId: string,
    repoId: string,
    ids: string[],
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      );
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const set = {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
    };
    if (Object.keys(set).length === 0) return this.getById(workspaceId, id);

    const [row] = await this.db
      .update(t.conventions)
      .set(set)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /**
   * Replace this repo's whole candidate set with a fresh scan.
   *
   * Wrapped in a transaction: a scan is delete-then-insert, and a failure
   * between the two would leave the repo with NO conventions while the UI still
   * shows a completed scan. Triage state is intentionally not preserved — a new
   * scan is a new set of claims about the current code.
   */
  /**
   * Land a fresh scan WITHOUT destroying triage.
   *
   * Only untriaged (`pending`) rows are replaced. Anything the user accepted or
   * rejected survives untouched, and `suppress` — keyed on the caller's
   * normalised rule text — stops the scan re-proposing it. Wiping the table
   * instead, as this used to, meant every re-scan resurrected every rejected
   * rule and the user re-triaged the same noise forever.
   *
   * Returns the triaged rows plus the newly inserted ones, and how many
   * candidates the suppression list swallowed.
   */
  async rescanForRepo(
    workspaceId: string,
    repoId: string,
    values: InsertConvention[],
    ruleKey: (rule: string) => string,
  ): Promise<{ rows: ConventionRow[]; suppressed: number }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      const triaged = existing.filter((r) => r.status !== 'pending');

      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );

      const seen = new Set(triaged.map((r) => ruleKey(r.rule)));
      const fresh = values.filter((v) => !seen.has(ruleKey(v.rule)));
      const suppressed = values.length - fresh.length;

      if (fresh.length === 0) return { rows: triaged, suppressed };
      const inserted = await tx
        .insert(t.conventions)
        .values(fresh.map((v) => ({ ...v, workspaceId, repoId, status: 'pending' as const })))
        .returning();
      return { rows: [...triaged, ...inserted], suppressed };
    });
  }

  /** Stamp `skillId` on the given candidates; returns how many rows matched. */
  async setSkillId(
    workspaceId: string,
    repoId: string,
    ids: string[],
    skillId: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(t.conventions)
      .set({ skillId })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }
}
