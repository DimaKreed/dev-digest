import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  PrIntentDetail,
  PrIntentStatus,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import type { StoredIntent } from './ports.js';
import { deriveIntent, intentDepsFrom } from './intent.js';
import { loadDiff } from './diff-loader.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  /**
   * PRs whose intent is being derived right now, so two simultaneous page opens
   * cannot fire two paid classifier calls.
   *
   * An INSTANCE field, not module state: the service is constructed once per
   * container, which gives the same guard without leaking across every
   * `buildApp()` in a test process. Still per-process, not cluster-safe — the
   * `head_sha` guard bounds the worst case to one duplicate call per commit.
   */
  private readonly inFlight = new Set<string>();

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // PR intent (Intent Layer)
  // ===========================================================================

  /**
   * `GET /pulls/:id/intent`.
   *
   * Reads the stored classification. When `auto_derive_intent` is ON and there
   * is no fresh row for the current head SHA, it KICKS OFF a background
   * derivation and returns immediately with `status: 'deriving'` — it never
   * waits for the model, so a page load is never blocked by an LLM call.
   *
   * A write triggered from a GET is deliberate, not inherited: decision H asks
   * for auto-derivation on PR open. It is bounded three ways — the toggle is OFF
   * by default, the `head_sha` guard makes it once per commit rather than once
   * per open, and the in-flight guard below stops two simultaneous opens firing
   * two paid calls. It is also reachable ONLY from this PR-DETAIL endpoint: wire
   * it into the PR *list* and opening the list fans out one paid call per PR.
   */
  async getIntent(workspaceId: string, prId: string): Promise<PrIntentDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getIntent(prId);
    const fresh = stored !== undefined && stored.head_sha === pull.headSha;

    if (fresh) return toIntentDetail(prId, stored, pull.headSha, 'ready');

    if (this.inFlight.has(prId)) {
      return toIntentDetail(prId, stored, pull.headSha, 'deriving');
    }

    const autoDerive = await this.autoDeriveEnabled(workspaceId);
    if (!autoDerive) return toIntentDetail(prId, stored, pull.headSha, 'absent');

    // Fire-and-forget. Errors are logged by the derivation itself and simply
    // leave the row untouched; the next GET tries again.
    void this.deriveIntentNow(workspaceId, prId).catch(() => undefined);
    return toIntentDetail(prId, stored, pull.headSha, 'deriving');
  }

  /**
   * `POST /pulls/:id/intent` — explicit (re-)derivation, regardless of the
   * toggle. Awaits the model, so the caller gets the finished classification.
   */
  async deriveIntentNow(workspaceId: string, prId: string): Promise<PrIntentDetail> {
    // Check-and-add with NO await between them, so it is atomic on the event
    // loop. Testing the guard before the awaited lookups (as this used to) let
    // two concurrent opens both pass the test and both pay for a call.
    if (this.inFlight.has(prId)) {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError('Pull request not found');
      const stored = await this.repo.getIntent(prId);
      return toIntentDetail(prId, stored, pull.headSha, 'deriving');
    }
    this.inFlight.add(prId);
    try {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError('Pull request not found');
      const repoRow = await this.repo.getRepo(pull.repoId);
      if (!repoRow) throw new NotFoundError('Repo not found');

      const deps = intentDepsFrom(this.container, (ws, key) => this.repo.settingValue(ws, key));
      const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);
      const derived = await deriveIntent(deps, {
        workspaceId,
        pull,
        repoRef: { owner: repoRow.owner, name: repoRow.name },
        diff,
      });
      await this.repo.upsertIntent(prId, {
        intent: derived.classification.intent,
        in_scope: derived.classification.in_scope,
        out_of_scope: derived.classification.out_of_scope,
        head_sha: pull.headSha,
        model: derived.model,
        confidence: derived.classification.confidence,
        sources: derived.classification.sources,
        missing_context: derived.classification.missing_context,
      });

      const stored = await this.repo.getIntent(prId);
      return toIntentDetail(prId, stored, pull.headSha, 'ready');
    } finally {
      this.inFlight.delete(prId);
    }
  }

  /** The `auto_derive_intent` toggle. Absent / unparseable ⇒ OFF. */
  private async autoDeriveEnabled(workspaceId: string): Promise<boolean> {
    const raw = await this.repo.settingValue(workspaceId, 'auto_derive_intent');
    return raw === true;
  }
}


/** Stored row (or its absence) + the current head SHA → the API read shape. */
function toIntentDetail(
  prId: string,
  stored: StoredIntent | undefined,
  headSha: string,
  status: PrIntentStatus,
): PrIntentDetail {
  if (!stored) {
    return {
      pr_id: prId,
      intent: '',
      in_scope: [],
      out_of_scope: [],
      head_sha: null,
      model: null,
      confidence: null,
      sources: null,
      missing_context: null,
      created_at: null,
      stale: false,
      status,
    };
  }
  return {
    pr_id: prId,
    intent: stored.intent,
    in_scope: stored.in_scope,
    out_of_scope: stored.out_of_scope,
    head_sha: stored.head_sha,
    model: stored.model,
    confidence: stored.confidence,
    sources: stored.sources,
    missing_context: stored.missing_context,
    created_at: stored.created_at,
    // Derived SERVER-side so the client needs no comparison logic. A row with no
    // `head_sha` at all predates the intent migration — treat it as stale, since
    // we cannot prove it describes this commit.
    stale: stored.head_sha !== headSha,
    status,
  };
}
