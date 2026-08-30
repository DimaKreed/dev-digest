import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalCaseRow,
  EvalCaseWrite,
  EvalRepositoryPort,
  EvalRunRow,
  EvalRunWrite,
} from './ports.js';

/**
 * Eval data-access. The ONLY place in this codebase that touches `eval_cases`
 * and `eval_runs`.
 *
 * TENANCY: `eval_cases` carries `workspace_id`; `eval_runs` does not — its only
 * key is `case_id`. So every run read joins through the case and filters on the
 * case's workspace, and there is no method here that reaches a run row without
 * that join. A repository that scopes its reads but not its writes is one
 * refactor away from being wrong, so `insertRun` takes a case id the service
 * has already resolved inside the workspace.
 */
export class EvalRepository implements EvalRepositoryPort {
  constructor(private db: Db) {}

  // ---- cases ---------------------------------------------------------------

  async listCases(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(t.evalCases.createdAt);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  /** Case counts per owner id, for the all-agents dashboard's one query. */
  async countCasesByOwner(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')),
      )
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.ownerId, Number(r.n)]));
  }

  async insertCase(
    workspaceId: string,
    ownerId: string,
    values: EvalCaseWrite,
  ): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: values.name,
        expectationKind: values.expectationKind,
        inputDiff: values.inputDiff,
        inputMeta: values.inputMeta as object | null,
        expectedOutput: values.expectedOutput,
        notes: values.notes,
        sourceFindingId: values.sourceFindingId,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    values: Partial<EvalCaseWrite>,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(values.name !== undefined ? { name: values.name } : {}),
        ...(values.expectationKind !== undefined
          ? { expectationKind: values.expectationKind }
          : {}),
        ...(values.inputDiff !== undefined ? { inputDiff: values.inputDiff } : {}),
        ...(values.inputMeta !== undefined
          ? { inputMeta: values.inputMeta as object | null }
          : {}),
        ...(values.expectedOutput !== undefined
          ? { expectedOutput: values.expectedOutput }
          : {}),
        ...(values.notes !== undefined ? { notes: values.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs ----------------------------------------------------------------

  async insertRun(values: EvalRunWrite): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId,
        agentVersion: values.agentVersion,
        systemPrompt: values.systemPrompt,
        model: values.model,
        actualOutput: values.actualOutput,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        counts: values.counts,
        error: values.error,
      })
      .returning();
    return row!;
  }

  /**
   * Every run row of an owner's cases, newest first, joined to its case.
   *
   * The join IS the tenancy filter: `eval_runs` has no workspace column, so the
   * only correct way to read one is through the case that owns it.
   */
  async listRuns(
    workspaceId: string,
    ownerId: string,
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows;
  }

  /**
   * The newest run of each of an owner's cases.
   *
   * Read as one descending scan and folded in memory rather than as a lateral
   * or a window function: the set is tens of rows per agent, and the SQL that
   * would save the fold is the SQL nobody can review.
   */
  async latestRunPerCase(
    workspaceId: string,
    ownerId: string,
  ): Promise<Map<string, EvalRunRow>> {
    const rows = await this.listRuns(workspaceId, ownerId, 5000);
    const latest = new Map<string, EvalRunRow>();
    for (const { run } of rows) {
      if (!latest.has(run.caseId)) latest.set(run.caseId, run);
    }
    return latest;
  }

  /**
   * Every run of ONE case, newest first.
   *
   * Scoped through the case, like every other run read here: `eval_runs` has no
   * workspace column, so a query that filters only on `case_id` would happily
   * return another tenant's rows for a guessed id.
   */
  async listRunsForCase(
    workspaceId: string,
    caseId: string,
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]> {
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.caseId, caseId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]> {
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.batchId, batchId)))
      .orderBy(t.evalRuns.ranAt);
  }

  /**
   * Every run row for a SET of owners, newest first — the all-agents dashboard.
   *
   * One query for the whole page instead of one per agent: the dashboard lists
   * every agent in the workspace, and N round-trips there is the difference
   * between a page that opens and a page that hangs on a cold connection.
   */
  async listRunsForOwners(
    workspaceId: string,
    ownerIds: string[],
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]> {
    if (ownerIds.length === 0) return [];
    return this.db
      .select({ run: t.evalRuns, case: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          inArray(t.evalCases.ownerId, ownerIds),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }
}
