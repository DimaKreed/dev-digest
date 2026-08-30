import { randomUUID } from 'node:crypto';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type {
  EvalAgentDashboard,
  EvalAgentSummary,
  EvalBatch,
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseRun,
  EvalDashboardAll,
  EvalExpectation,
  EvalExpectationKind,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import {
  EVAL_CASE_TIMEOUT_MS,
  EVAL_CONCURRENCY,
  EVAL_HISTORY_LIMIT,
  EVAL_MAX_RETRIES,
  EVAL_RECENT_RUNS_LIMIT,
  EVAL_RUN_ROWS_LIMIT,
  EVAL_STRATEGY,
} from './constants.js';
import {
  alertFor,
  deltaBetween,
  groupBatches,
  parseExpectations,
  pendingBatch,
  toCaseDto,
  toCaseRunDto,
  toSummary,
  toTrendPoint,
} from './helpers.js';
import type {
  ActiveBatch,
  EvalAgent,
  EvalAgentReads,
  EvalCaseRow,
  EvalCaseWrite,
  EvalEngineDeps,
  EvalEngineOutcome,
  EvalFindingContext,
  EvalFindingReads,
  EvalRepositoryPort,
  EvalRunWrite,
} from './ports.js';
import { scoreCase } from './scoring.js';

/**
 * What every case in a batch shares: the agent's enabled skills and one
 * provider client. Resolved once per batch, and — for a backgrounded batch —
 * resolved BEFORE the response is sent, so a bad provider is a status code
 * rather than a batch that silently never writes a row.
 */
type EvalBatchContext = {
  skills: string[];
  llm: Awaited<ReturnType<EvalEngineDeps['llm']>>;
};

/**
 * The eval pipeline (SPEC-04) — a regression harness for reviewer agents.
 *
 * One run of the set executes the SAME review engine a pull-request review
 * runs, once per case, over inputs frozen in the case row. Everything that
 * decides the outcome — prompt assembly, the grounding gate, the scope filter —
 * is shared with a real review; what differs is that nothing is fetched. AC-13
 * is the whole point: a case never re-reads the pull request it came from, so a
 * batch run today and a batch run next month see byte-identical input and the
 * only variable left is the agent.
 *
 * Scoring is `./scoring.ts` and reaches no model (AC-06). The single model call
 * per case is the engine's own.
 */
export class EvalService {
  constructor(
    private deps: {
      repo: EvalRepositoryPort;
      agents: EvalAgentReads;
      findings: EvalFindingReads;
      engine: EvalEngineDeps;
    },
  ) {}

  /**
   * Batches this process is executing right now, keyed by batch id.
   *
   * A run of the set is N model calls — a minute, not seconds — so
   * the route accepts it and returns immediately, and the client polls
   * `getBatch`. The progress itself is NOT tracked here: every case persists
   * its own row the moment it finishes, so `cases_done` is a count of rows and
   * this map only has to remember what the batch set out to do. That keeps one
   * source of truth for the results and makes a crashed process honest — the
   * entry disappears with the process, and the poll reports what actually
   * landed rather than a `running` that nobody will ever clear.
   */
  private active = new Map<string, ActiveBatch>();

  // ---- cases ---------------------------------------------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    await this.requireAgent(workspaceId, agentId);
    const [rows, latest] = await Promise.all([
      this.deps.repo.listCases(workspaceId, agentId),
      this.deps.repo.latestRunPerCase(workspaceId, agentId),
    ]);
    return rows.map((r) => toCaseDto(r, latest.get(r.id)));
  }

  async createCase(
    workspaceId: string,
    agentId: string,
    input: {
      name: string;
      expectation_kind: EvalExpectationKind;
      input_diff: string;
      input_meta?: unknown;
      expected_output: EvalExpectation[];
      notes?: string | null;
      source_finding_id?: string | null;
    },
  ): Promise<EvalCaseRecord> {
    await this.requireAgent(workspaceId, agentId);
    // A case with no diff can never do anything but fail, and a set full of
    // those reads as a broken agent rather than as broken cases (spec § Edge
    // cases). Reject at creation, where the message can still name the cause.
    if (input.input_diff.trim().length === 0) {
      throw new ValidationError('An eval case needs a diff to run the agent against');
    }
    const row = await this.deps.repo.insertCase(workspaceId, agentId, {
      name: input.name,
      expectationKind: input.expectation_kind,
      inputDiff: input.input_diff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
      sourceFindingId: input.source_finding_id ?? null,
    });
    return toCaseDto(row);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: {
      name?: string;
      expectation_kind?: EvalExpectationKind;
      input_diff?: string;
      input_meta?: unknown;
      expected_output?: EvalExpectation[];
      notes?: string | null;
    },
  ): Promise<EvalCaseRecord> {
    const values: Partial<EvalCaseWrite> = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.expectation_kind !== undefined
        ? { expectationKind: patch.expectation_kind }
        : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined
        ? { expectedOutput: patch.expected_output }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    const row = await this.deps.repo.updateCase(workspaceId, caseId, values);
    if (!row) throw new NotFoundError('Eval case not found');
    return toCaseDto(row);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const ok = await this.deps.repo.deleteCase(workspaceId, caseId);
    if (!ok) throw new NotFoundError('Eval case not found');
  }

  /**
   * The DRAFT a finding would become — resolved, validated, and not persisted.
   *
   * Everything `seedFromFinding` would reject (no owning agent, no stored
   * patch) is rejected here too, so the editor never opens over a case that
   * could not be saved anyway. What it does NOT do is write a row: the user
   * has not decided yet, and a case created by opening a dialog is a case
   * nobody chose to keep.
   */
  async draftFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
    const { ctx, agent, patch: filePatch } = await this.resolveSeed(workspaceId, findingId);
    const seed = this.seedValues(ctx, filePatch, undefined);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      name: seed.name,
      expectation_kind: seed.expectationKind,
      input_diff: seed.inputDiff,
      input_meta: seed.inputMeta,
      expected_output: seed.expectedOutput,
      source_finding_id: findingId,
      input_files: [ctx.finding.file],
    };
  }

  /**
   * Run a case's CONTENT once, against the agent, and persist nothing (AC-18).
   *
   * The same engine call and the same scorer a saved case gets — anything less
   * would make the preview a different measurement from the one the case will
   * report a minute later, which is worse than no preview. The returned row
   * carries empty ids because there is no row: it is a shape the editor can
   * render with the component that renders a real run.
   */
  async previewCase(
    workspaceId: string,
    agentId: string,
    input: {
      expectation_kind: EvalExpectationKind;
      input_diff: string;
      input_meta?: unknown;
      expected_output: EvalExpectation[];
    },
  ): Promise<EvalCaseRun> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const skills = (await this.deps.agents.linkedSkills(agent.id))
      .filter((l) => l.skill.enabled)
      .map((l) => l.skill.body);
    const llm = await this.deps.engine.llm(agent.provider);

    // A synthetic row, so `runOne` sees exactly what it sees for a saved case.
    const row: EvalCaseRow = {
      id: '',
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'preview',
      inputDiff: input.input_diff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: null,
      expectationKind: input.expectation_kind,
      sourceFindingId: null,
      createdAt: new Date(),
    };

    const started = Date.now();
    try {
      // The same ceiling a saved case gets. AC-19 makes this the same engine
      // call; the difference is that this one holds an HTTP request open, so an
      // unbounded case here is strictly worse than an unbounded case in a batch.
      const outcome = await withTimeout(
        this.runOne(agent, row, skills, llm),
        EVAL_CASE_TIMEOUT_MS,
      );
      const scored = scoreCase({
        expectationKind: input.expectation_kind,
        expectations: input.expected_output,
        findings: outcome.findings,
        groundedKept: outcome.groundedKept,
        groundedTotal: outcome.groundedTotal,
      });
      return {
        id: '',
        case_id: '',
        case_name: 'preview',
        expectation_kind: input.expectation_kind,
        ran_at: new Date().toISOString(),
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citation_accuracy: scored.citationAccuracy,
        duration_ms: Date.now() - started,
        cost_usd: outcome.costUsd,
        counts: scored.counts,
        findings: outcome.findings,
        missed: scored.missed,
        violations: scored.violations,
        error: null,
      };
    } catch (e) {
      // Reported as a row with an error, not as a 500: an unparseable diff or a
      // provider hiccup is information the editor should show in place, beside
      // the field that caused it.
      return {
        id: '',
        case_id: '',
        case_name: 'preview',
        expectation_kind: input.expectation_kind,
        ran_at: new Date().toISOString(),
        pass: null,
        recall: null,
        precision: null,
        citation_accuracy: null,
        duration_ms: Date.now() - started,
        cost_usd: null,
        counts: null,
        findings: [],
        missed: [],
        violations: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Seed one case from one real finding (AC-01/AC-02) — the one-click path.
   *
   * The polarity is read off the finding's own action timestamps rather than
   * asked for: an accepted finding IS a `must_find` label and a dismissed one
   * IS a `must_not_flag` label. That is what makes the L01–L05 accept/dismiss
   * history a dataset instead of a pile of clicks.
   */
  async seedFromFinding(
    workspaceId: string,
    findingId: string,
    override?: { name?: string; expectation_kind?: EvalExpectationKind },
  ): Promise<EvalCaseRecord> {
    const { ctx, agent, patch: filePatch } = await this.resolveSeed(workspaceId, findingId);
    const row = await this.deps.repo.insertCase(
      workspaceId,
      agent.id,
      this.seedValues(ctx, filePatch, override),
    );
    return toCaseDto(row);
  }

  /**
   * Everything the seeding path must prove before a case can exist, in one
   * place — so the draft and the save can never disagree about what is valid.
   */
  private async resolveSeed(
    workspaceId: string,
    findingId: string,
  ): Promise<{ ctx: EvalFindingContext; agent: EvalAgent; patch: string }> {
    const ctx = await this.deps.findings.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');
    // Tenancy: the finding is reached by id alone, so the workspace it belongs
    // to is checked here rather than assumed from the caller's context.
    if (ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    // AC-03. A seeded review (no agent) has no owner to attach the case to, and
    // inventing one would produce a case that scores an agent that never made
    // the finding.
    if (!ctx.review.agentId) {
      throw new ValidationError(
        'This finding has no owning agent (it came from a seeded review), so it cannot become an eval case',
      );
    }
    const agent = await this.requireAgent(workspaceId, ctx.review.agentId);

    const files = await this.deps.findings.getPrFiles(ctx.pull.id);
    const file = files.find((f) => f.path === ctx.finding.file);
    if (!file?.patch) {
      throw new ValidationError(
        `No stored patch for ${ctx.finding.file}, so there is no diff to freeze into a case`,
      );
    }
    return { ctx, agent, patch: file.patch };
  }

  /** The case a finding becomes. Pure once the reads above have happened. */
  private seedValues(
    ctx: EvalFindingContext,
    filePatch: string,
    override: { name?: string; expectation_kind?: EvalExpectationKind } | undefined,
  ): EvalCaseWrite {
    const kind: EvalExpectationKind =
      override?.expectation_kind ??
      (ctx.finding.dismissedAt ? 'must_not_flag' : 'must_find');

    return {
      name: override?.name ?? `From finding: ${ctx.finding.title}`,
      expectationKind: kind,
      // The diff is frozen HERE, from the patch stored on the pull request at
      // the time of the click. The case never looks at the pull request again.
      inputDiff: unifiedDiffFor(ctx.finding.file, filePatch),
      inputMeta: {
        title: ctx.pull.title,
        pr_number: ctx.pull.number,
        head_sha: ctx.pull.headSha,
      },
      expectedOutput: [
        {
          file: ctx.finding.file,
          start_line: ctx.finding.startLine,
          end_line: ctx.finding.endLine,
          severity: ctx.finding.severity as EvalExpectation['severity'],
          category: ctx.finding.category as EvalExpectation['category'],
          title: ctx.finding.title,
        },
      ],
      notes: null,
      sourceFindingId: ctx.finding.id,
    };
  }

  // ---- runs ----------------------------------------------------------------

  /** Run the agent over ONE case. Returns a batch of one, so both paths agree. */
  async runCase(workspaceId: string, caseId: string): Promise<EvalBatch> {
    const row = await this.deps.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const agent = await this.requireAgent(workspaceId, row.ownerId);
    return this.runBatch(workspaceId, agent, [row]);
  }

  /** Run the agent over its whole set (AC-05). One batch id, one row per case. */
  async runAll(workspaceId: string, agentId: string): Promise<EvalBatch> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const rows = await this.deps.repo.listCases(workspaceId, agentId);
    if (rows.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }
    return this.runBatch(workspaceId, agent, rows);
  }

  /**
   * Accept a run of the whole set and execute it in the background (AC-05).
   *
   * This is what the route calls; `runAll` above is the same work awaited to
   * completion, which is what a test or a script wants. The two share
   * `runBatch`, so there is one execution path and one place AC-07 is honoured.
   */
  async startAll(workspaceId: string, agentId: string): Promise<EvalBatch> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const rows = await this.deps.repo.listCases(workspaceId, agentId);
    if (rows.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }
    return this.startBatch(workspaceId, agent, rows);
  }

  /**
   * Accept a run of ONE case, backgrounded exactly like the set.
   *
   * A batch of one, so a single case and a whole set are polled, rendered and
   * invalidated by the same client code — one case is 10+ seconds, which is
   * already too long to hold a request open for.
   */
  async startCase(workspaceId: string, caseId: string): Promise<EvalBatch> {
    const row = await this.deps.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const agent = await this.requireAgent(workspaceId, row.ownerId);
    return this.startBatch(workspaceId, agent, [row]);
  }

  /** The agent's skills and provider client — everything a batch needs upfront. */
  private async batchContext(agent: EvalAgent): Promise<EvalBatchContext> {
    const skills = (await this.deps.agents.linkedSkills(agent.id))
      .filter((l) => l.skill.enabled)
      .map((l) => l.skill.body);
    const llm = await this.deps.engine.llm(agent.provider);
    return { skills, llm };
  }

  /**
   * Register a batch, start it, and answer with it EMPTY.
   *
   * `batchContext` is awaited first on purpose: an unknown provider or a
   * missing key must fail this call, not a background task nobody is reading.
   * What is left inside the loop is per-case failure, which `runBatch` already
   * persists on the case's own row (AC-07). A failure past that point — a
   * dropped DB connection, say — has nothing left to write itself to, so the
   * batch simply stops being `running`; the poll then reports the rows that did
   * land, which is the truth, rather than a spinner with no end.
   */
  private async startBatch(
    workspaceId: string,
    agent: EvalAgent,
    cases: EvalCaseRow[],
  ): Promise<EvalBatch> {
    const context = await this.batchContext(agent);
    const batchId = randomUUID();
    const active: ActiveBatch = {
      workspaceId,
      agentId: agent.id,
      agentName: agent.name,
      agentVersion: agent.version,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      total: cases.length,
      startedAt: new Date().toISOString(),
    };
    this.active.set(batchId, active);

    void this.runBatch(workspaceId, agent, cases, batchId, context)
      .catch(() => {})
      .finally(() => this.active.delete(batchId));

    return pendingBatch(batchId, active);
  }

  /**
   * Execute a set of cases under ONE batch id, `EVAL_CONCURRENCY` at a time.
   *
   * The cases are independent by construction: each replays a frozen diff and
   * reads nothing the others produce (AC-13), so the only thing sequencing them
   * bought was wall clock — a measured ten-case set spent 111 s, the exact sum
   * of its ten model calls. A fixed pool rather than `Promise.all` because the
   * ceiling here is the provider's rate limit, not this process.
   *
   * A case that throws is persisted with its error and the batch continues
   * (AC-07) — a provider hiccup on case 3 must not destroy the evidence from
   * cases 1, 2, 4 and 5. That is per-case and unaffected by the pool: each
   * worker catches its own case, so a failure still lands as one readable row
   * rather than taking its neighbours with it.
   *
   * Results are collected BY INDEX, not by completion: `Promise.all` over a
   * pool would otherwise leave the batch's case order at the mercy of which
   * model call happened to answer first, and two runs of one set would list
   * their cases differently for no reason a reader could see.
   */
  private async runBatch(
    workspaceId: string,
    agent: EvalAgent,
    cases: EvalCaseRow[],
    batchId: string = randomUUID(),
    context?: EvalBatchContext,
  ): Promise<EvalBatch> {
    const { skills, llm } = context ?? (await this.batchContext(agent));

    type Row = { run: Awaited<ReturnType<EvalRepositoryPort['insertRun']>>; case: EvalCaseRow };
    const rows: (Row | undefined)[] = new Array<Row | undefined>(cases.length);
    const isRow = (r: Row | undefined): r is Row => r !== undefined;

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        const row = cases[index];
        if (!row) return;
        rows[index] = { run: await this.runAndPersist(agent, row, batchId, skills, llm), case: row };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(EVAL_CONCURRENCY, cases.length) }, worker),
    );

    const [batch] = groupBatches(rows.filter(isRow), agent.id, agent.name);
    // groupBatches always yields exactly one batch here — every row was written
    // with the same batchId — but the array access is narrowed rather than
    // asserted, because `noUncheckedIndexedAccess` is on for a reason.
    if (!batch) throw new ValidationError('The batch produced no rows');
    return batch;
  }

  /**
   * Run ONE case and persist its row. Never throws for a case-level failure.
   *
   * This is the unit the pool schedules, and the `catch` is why the pool is
   * safe: whatever one case does to itself stays on that case's own row.
   *
   * The deadline is applied HERE rather than passed down as a per-request
   * timeout, because the provider nests its own retries inside that timeout —
   * bounding the request bounds one attempt, not the case. This bounds the
   * case. The race does not cancel the call it lost to: the orphaned request
   * runs to completion somewhere and its answer is discarded, which costs the
   * tokens already committed but frees the pool slot immediately. Cancelling
   * properly would mean threading an `AbortSignal` through `reviewPullRequest`,
   * which takes none.
   */
  private async runAndPersist(
    agent: EvalAgent,
    row: EvalCaseRow,
    batchId: string,
    skills: string[],
    llm: EvalBatchContext['llm'],
  ) {
    const started = Date.now();
    const base = {
      caseId: row.id,
      batchId,
      agentVersion: agent.version,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
    };

    let write: EvalRunWrite;
    try {
      const outcome = await withTimeout(
        this.runOne(agent, row, skills, llm),
        EVAL_CASE_TIMEOUT_MS,
      );
      const expectations = parseExpectations(row.expectedOutput);
      // Scoring: pure, synchronous, no model (AC-06).
      const scored = scoreCase({
        expectationKind: row.expectationKind,
        expectations,
        findings: outcome.findings,
        groundedKept: outcome.groundedKept,
        groundedTotal: outcome.groundedTotal,
      });
      write = {
        ...base,
        actualOutput: {
          findings: outcome.findings,
          missed: scored.missed,
          violations: scored.violations,
        },
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citationAccuracy,
        durationMs: Date.now() - started,
        costUsd: outcome.costUsd,
        counts: scored.counts,
        error: null,
      };
    } catch (e) {
      write = {
        ...base,
        actualOutput: { findings: [], missed: [], violations: [] },
        // `null`, not `false`: the case did not fail the assertion, it never
        // got to make one. A `false` here would be counted as a real miss by
        // every reader of the column.
        pass: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: Date.now() - started,
        costUsd: null,
        counts: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return this.deps.repo.insertRun(write);
  }

  /**
   * One case through the review engine.
   *
   * The strategy is pinned (`EVAL_STRATEGY`) rather than taken from the agent:
   * a case's diff is one small file, so `auto` would choose single-pass anyway,
   * and pinning removes one way for two batches to stop being comparable.
   * Everything else — prompt, skills, gate, grounding — is the agent's own.
   */
  private async runOne(
    agent: EvalAgent,
    row: EvalCaseRow,
    skills: string[],
    llm: Awaited<ReturnType<EvalEngineDeps['llm']>>,
  ): Promise<EvalEngineOutcome> {
    const diff = this.deps.engine.parseDiff(row.inputDiff ?? '');
    if (diff.files.length === 0) {
      throw new Error(
        'The stored diff for this case contained no file changes the parser could read',
      );
    }

    const meta = (row.inputMeta ?? {}) as { title?: unknown; body?: unknown };
    const title = typeof meta.title === 'string' ? meta.title : row.name;
    const body = typeof meta.body === 'string' ? meta.body : undefined;

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: EVAL_STRATEGY,
      failOn: agent.ciFailOn,
      ...(skills.length > 0 ? { skills } : {}),
      ...(body ? { prDescription: body } : {}),
      task: `Review the change below. Context: ${title}`,
      maxRetries: EVAL_MAX_RETRIES,
      // Mirrors run-executor and diff-review: nothing may be deferred out of
      // the numbers at a WARNING gate.
      allowDefer: agent.ciFailOn !== 'warning',
    });

    // What the citation gate KEPT is the active set plus whatever the scope
    // filter deferred afterwards — deferring is not a grounding failure, and
    // counting it as one would make citation accuracy fall for a finding the
    // gate passed. The total is that plus what grounding actually dropped.
    const kept = outcome.review.findings.length + outcome.deferred.length;
    return {
      findings: outcome.review.findings,
      groundedKept: kept,
      groundedTotal: kept + outcome.dropped.length,
      costUsd: outcome.costUsd,
    };
  }

  // ---- reads ---------------------------------------------------------------

  /**
   * Every run of ONE case, newest first — expected vs actual over time.
   *
   * The case is resolved inside the workspace first, so an id from another
   * tenant is a 404 rather than an empty list that reads as "never run".
   */
  async listCaseRuns(workspaceId: string, caseId: string) {
    const row = await this.deps.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const rows = await this.deps.repo.listRunsForCase(workspaceId, caseId, EVAL_HISTORY_LIMIT);
    return rows.map((r) => toCaseRunDto(r.run, r.case));
  }

  /**
   * One batch with its per-case rows — and its progress while it is running.
   *
   * The in-flight entry is read BEFORE the rows, not after, and the order is
   * load-bearing: read the rows first and a batch that finishes in between
   * reports `done` over a row set that was still being written, silently losing
   * its last case. Reading `active` first can only err the harmless way — one
   * extra poll of a batch that has just finished.
   *
   * The workspace check on the entry is the same tenancy rule the row read
   * applies: a batch id guessed from another tenant must not become a readable
   * progress bar just because nothing has been persisted for it yet.
   */
  async getBatch(workspaceId: string, batchId: string): Promise<EvalBatch> {
    const entry = this.active.get(batchId);
    const running = entry && entry.workspaceId === workspaceId ? entry : undefined;

    const rows = await this.deps.repo.getBatch(workspaceId, batchId);
    const first = rows[0];
    if (!first) {
      // Accepted moments ago with no case finished yet. That is a batch in its
      // first seconds, not a 404 — answering 404 here would make the client's
      // very first poll look like a run that never happened.
      if (running) return pendingBatch(batchId, running);
      throw new NotFoundError('Eval run not found');
    }
    const agent = await this.deps.agents.getById(workspaceId, first.case.ownerId);
    const [batch] = groupBatches(rows, first.case.ownerId, agent?.name);
    if (!batch) throw new NotFoundError('Eval run not found');
    if (!running) return batch;
    return {
      ...batch,
      status: 'running',
      cases_total: running.total,
      cases_done: batch.cases.length,
    };
  }

  /** An agent's batch history, newest first (AC-09). */
  async listBatches(workspaceId: string, agentId: string) {
    const agent = await this.requireAgent(workspaceId, agentId);
    const rows = await this.deps.repo.listRuns(workspaceId, agentId, EVAL_RUN_ROWS_LIMIT);
    return groupBatches(rows, agentId, agent.name)
      .slice(0, EVAL_HISTORY_LIMIT)
      .map(toSummary);
  }

  /** One agent's dashboard: current metrics, delta, trend and history. */
  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalAgentDashboard> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const [rows, cases] = await Promise.all([
      this.deps.repo.listRuns(workspaceId, agentId, EVAL_RUN_ROWS_LIMIT),
      this.deps.repo.listCases(workspaceId, agentId),
    ]);
    const batches = groupBatches(rows, agentId, agent.name)
      .slice(0, EVAL_HISTORY_LIMIT)
      .map(toSummary);

    const latest = batches[0] ?? null;
    const previous = batches[1] ?? null;

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      model: agent.model,
      cases_total: cases.length,
      latest,
      delta: deltaBetween(latest, previous),
      // Oldest first — a chart reads left to right, while the table above it
      // reads newest first. Reversing here rather than in the client keeps the
      // two orders from being an accident of whoever wrote the component.
      trend: [...batches].reverse().map(toTrendPoint),
      batches,
      alert: alertFor(latest, previous),
    };
  }

  /** Every agent plus the newest batches across all of them (AC-11). */
  async dashboard(workspaceId: string): Promise<EvalDashboardAll> {
    const agents = await this.deps.agents.list(workspaceId);
    const [counts, rows] = await Promise.all([
      this.deps.repo.countCasesByOwner(workspaceId),
      this.deps.repo.listRunsForOwners(
        workspaceId,
        agents.map((a) => a.id),
        EVAL_RUN_ROWS_LIMIT,
      ),
    ]);

    const byAgent = new Map<string, typeof rows>();
    for (const r of rows) {
      const bucket = byAgent.get(r.case.ownerId);
      if (bucket) bucket.push(r);
      else byAgent.set(r.case.ownerId, [r]);
    }

    const summaries: EvalAgentSummary[] = [];
    const all: ReturnType<typeof toSummary>[] = [];
    for (const agent of agents) {
      const batches = groupBatches(byAgent.get(agent.id) ?? [], agent.id, agent.name)
        .slice(0, EVAL_HISTORY_LIMIT)
        .map(toSummary);
      all.push(...batches);
      summaries.push({
        agent_id: agent.id,
        agent_name: agent.name,
        model: agent.model,
        cases_total: counts.get(agent.id) ?? 0,
        // AC-12: null, never a zeroed metric block. "Never run" and "scored 0"
        // are different facts and the dashboard must not merge them.
        latest: batches[0] ?? null,
        trend: [...batches].reverse().map((b) => b.metrics.recall),
      });
    }

    all.sort((a, b) => b.ran_at.localeCompare(a.ran_at));
    return { agents: summaries, recent_runs: all.slice(0, EVAL_RECENT_RUNS_LIMIT) };
  }

  // ---- shared --------------------------------------------------------------

  /** The agent, or a 404. This is the authorization boundary for every route. */
  private async requireAgent(workspaceId: string, agentId: string): Promise<EvalAgent> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }
}

/**
 * A stored `pr_files.patch` → a parseable unified diff.
 *
 * The same reconstruction `modules/reviews/diff-loader.ts` performs, restated
 * rather than imported: reaching into a sibling module trips `no-cross-module`.
 * It must stay equal to that one — a case whose diff was assembled differently
 * from the review path would ground its findings against different line
 * numbers, which is the one thing this harness cannot afford.
 */
function unifiedDiffFor(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}
