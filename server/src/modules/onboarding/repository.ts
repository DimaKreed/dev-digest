import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  OnboardingRepositoryPort,
  RepoInfo,
  StoredTour,
} from './ports.js';

/**
 * Onboarding data-access. The ONLY place that touches `onboarding`.
 *
 * It also READS two tables it does not own — `repos` (to resolve tenancy, the
 * clone ref and the blob-URL base) and `settings` (the workspace's per-feature
 * model choice). That is table access, not a cross-module import, and it writes
 * to neither. Same precedent as the conventions repository.
 *
 * TENANCY: the `onboarding` table carries no `workspace_id`, unlike every other
 * domain table — its only key is `repo_id`. So both the read and the write
 * resolve the workspace through `repos` FIRST and address the tour by a repo id
 * that has already been proven to belong to the caller. There is no path here
 * that reaches a tour row without that check.
 *
 * The tour is ONE document in ONE row, so a generation is a single write: no
 * transaction is owed and no partial state exists to specify.
 */
export class OnboardingRepository implements OnboardingRepositoryPort {
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

  // ---- onboarding ----------------------------------------------------------

  /**
   * The stored tour, or `undefined` when there is none — or when the repo it
   * belongs to is not this workspace's. The join is the tenancy check.
   */
  async get(workspaceId: string, repoId: string): Promise<StoredTour | undefined> {
    const [row] = await this.db
      .select({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt })
      .from(t.onboarding)
      .innerJoin(t.repos, eq(t.repos.id, t.onboarding.repoId))
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.onboarding.repoId, repoId)));
    return row;
  }

  /**
   * Replace this repo's tour. `repo_id` is the primary key, so the conflict
   * clause gives last-write-wins for free: two concurrent generations both
   * succeed and the later write is the one that survives. There are no tour
   * versions by design.
   *
   * Tenancy is re-resolved here rather than trusted from the caller: the row
   * has no `workspace_id` of its own, so the ONLY thing that can scope a write
   * to it is the owning repo, and a repository method that scopes its read but
   * not its write is one refactor away from being wrong.
   */
  async upsert(workspaceId: string, repoId: string, json: unknown): Promise<StoredTour> {
    const owner = await this.getRepo(workspaceId, repoId);
    if (!owner) throw new Error(`onboarding upsert refused: repo ${repoId} is not this workspace's`);
    const generatedAt = new Date();
    const [row] = await this.db
      .insert(t.onboarding)
      .values({ repoId, json, generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json, generatedAt },
      })
      .returning({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt });
    if (!row) throw new Error(`onboarding upsert wrote no row for repo ${repoId}`);
    return row;
  }
}
