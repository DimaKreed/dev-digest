import type {
  EvalCaseCounts,
  EvalExpectation,
  EvalExpectationKind,
  Finding,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';

/**
 * Domain types and ports for the eval module (ring 1).
 *
 * Everything a sibling slice would otherwise supply is RESTATED here rather
 * than imported: any reach into `modules/<other>/` trips the `no-cross-module`
 * arch rule, type-only imports included. The composition root in `routes.ts`
 * hands in objects that satisfy these shapes structurally — `AgentsRepository`
 * and `ReviewRepository` already do, with no `implements` and no adapter.
 */

// --- agent reads -------------------------------------------------------------

/** Exactly the agent fields a run needs. A subset of `AgentRow`, restated. */
export interface EvalAgent {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
  version: number;
  enabled: boolean;
}

/**
 * A batch this process is currently executing.
 *
 * Held in memory, never in a column: a batch cannot outlive the process that
 * runs it, so a persisted `running` flag would be stale every time the server
 * restarts mid-set and nothing would ever clear it. The snapshot fields are the
 * agent as it was when the batch was accepted — the same values the rows will
 * carry (AC-08), so a running batch and a finished one describe one agent.
 */
export interface ActiveBatch {
  workspaceId: string;
  agentId: string;
  agentName: string;
  agentVersion: number;
  systemPrompt: string;
  model: string;
  /** Cases the batch set out to run. Fixed at accept time. */
  total: number;
  /** ISO timestamp of when the batch was accepted, not of its first row. */
  startedAt: string;
}

/** One linked skill, narrowed to what the prompt needs. */
export interface EvalLinkedSkill {
  skill: { id: string; body: string; enabled: boolean };
}

/** The three agent reads this slice performs. */
export interface EvalAgentReads {
  getById(workspaceId: string, id: string): Promise<EvalAgent | undefined>;
  list(workspaceId: string): Promise<EvalAgent[]>;
  linkedSkills(agentId: string): Promise<EvalLinkedSkill[]>;
}

// --- finding reads (seeding a case from a real finding) ----------------------

/** The finding a case is seeded from, plus the review and PR that carry it. */
export interface EvalFindingContext {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  review: { id: string; agentId: string | null };
  pull: { id: string; workspaceId: string; number: number; title: string; headSha: string };
}

/** The two review-domain reads this slice performs, both for seeding (AC-01). */
export interface EvalFindingReads {
  findingContext(findingId: string): Promise<EvalFindingContext | undefined>;
  getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
}

// --- persistence -------------------------------------------------------------

/** An `eval_cases` row, as this module reads and writes it. */
export interface EvalCaseRow {
  id: string;
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
  expectationKind: EvalExpectationKind;
  sourceFindingId: string | null;
  createdAt: Date;
}

/** What creating or updating a case supplies. */
export interface EvalCaseWrite {
  name: string;
  expectationKind: EvalExpectationKind;
  inputDiff: string;
  inputMeta: unknown;
  expectedOutput: EvalExpectation[];
  notes: string | null;
  sourceFindingId: string | null;
}

/** An `eval_runs` row. `counts` is `null` for a case whose model call failed. */
export interface EvalRunRow {
  id: string;
  caseId: string;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  batchId: string | null;
  agentVersion: number | null;
  systemPrompt: string | null;
  model: string | null;
  counts: unknown;
  error: string | null;
}

/** One row written per case per batch. */
export interface EvalRunWrite {
  caseId: string;
  batchId: string;
  agentVersion: number;
  systemPrompt: string;
  model: string;
  /**
   * What the agent actually said, plus the scorer's own verdict on it. `missed`
   * and `violations` are persisted rather than recomputed on read so the case
   * editor's expected-vs-actual view and the metric beside it can never
   * disagree about what matched.
   */
  actualOutput: { findings: Finding[]; missed: EvalExpectation[]; violations: Finding[] };
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  counts: EvalCaseCounts | null;
  error: string | null;
}

/**
 * Repository port (C3) — the persistence surface `EvalService` depends on.
 *
 * Both tables are workspace-scoped through `eval_cases.workspace_id`, which the
 * shipped schema already carries; `eval_runs` has no workspace column of its
 * own and is always reached through its case, so there is no path here that
 * touches a run row without having resolved the case's workspace first.
 */
export interface EvalRepositoryPort {
  listCases(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]>;
  getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined>;
  countCasesByOwner(workspaceId: string): Promise<Map<string, number>>;
  insertCase(
    workspaceId: string,
    ownerId: string,
    values: EvalCaseWrite,
  ): Promise<EvalCaseRow>;
  updateCase(
    workspaceId: string,
    caseId: string,
    values: Partial<EvalCaseWrite>,
  ): Promise<EvalCaseRow | undefined>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;
  insertRun(values: EvalRunWrite): Promise<EvalRunRow>;
  /** Every run row of an owner's cases, newest first. Joined back to the case. */
  listRuns(
    workspaceId: string,
    ownerId: string,
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]>;
  /** The newest run of each case of an owner (for the case list's last result). */
  latestRunPerCase(workspaceId: string, ownerId: string): Promise<Map<string, EvalRunRow>>;
  /** Every run of ONE case, newest first — the per-case history. */
  listRunsForCase(
    workspaceId: string,
    caseId: string,
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]>;
  /** Every run row for a SET of owners, newest first — the all-agents dashboard. */
  listRunsForOwners(
    workspaceId: string,
    ownerIds: string[],
    limit: number,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]>;
  /** Every row of one batch, with its case. Empty when the batch is unknown. */
  getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ run: EvalRunRow; case: EvalCaseRow }[]>;
}

// --- engine seam -------------------------------------------------------------

/**
 * What running ONE case against the engine yields.
 *
 * `groundedTotal` is kept separate from `findings.length` on purpose: the
 * findings are what SURVIVED the citation gate and scope filter, while the
 * total is what the gate was handed. Citation accuracy is the ratio between
 * them, and collapsing the two would make it permanently 1.
 */
export interface EvalEngineOutcome {
  findings: Finding[];
  groundedKept: number;
  groundedTotal: number;
  costUsd: number | null;
}

/** The engine call, injected so a test can score a run with no model at all. */
export interface EvalEngineDeps {
  llm(provider: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider>;
  parseDiff(raw: string): UnifiedDiff;
}
