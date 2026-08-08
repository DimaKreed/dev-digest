import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import {
  deriveIntent,
  intentBlock,
  intentDepsFrom,
  resolveIntentModel,
  type IntentDeps,
} from './intent.js';

/**
 * The derived PR intent as the executor carries it: the prompt block plus the
 * classifier's usage, which is reported per-trace and deliberately kept out of
 * `agent_runs.cost_usd`.
 */
type DerivedIntent = {
  block: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
};

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // ---- Pre-work: derive (or reuse) the PR intent -------------------------
    // Runs ONCE per review request, inside the FANNED-OUT logger, so on
    // {all: true} it happens once and shows up in every target run's live log
    // and trace. Deliberately NOT wrapped in failAll: intent is enrichment, and
    // failing N runs over an optional classification would regress behaviour
    // that works today. A throw here leaves `intent` undefined and every agent
    // gets exactly the pre-intent prompt.
    let intent: DerivedIntent | undefined;
    try {
      intent = await runLog.step(
        'Deriving PR intent',
        () => this.deriveOrReuseIntent(workspaceId, pull, repo, diff, runLog),
        { kind: 'tool' },
      );
    } catch (err) {
      runLog.error(`intent: derivation failed — ${(err as Error).message}; continuing without it`);
      intent = undefined;
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          runLog,
          intent,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    intent?: DerivedIntent,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // Skills — ordered instruction blocks linked to this agent. `linkedSkills`
      // already returns them ORDER BY agent_skills.order, which is exactly the
      // order they appear in the assembled prompt.
      //
      // A globally disabled skill is filtered out here, so it never reaches the
      // prompt and never shows up in the run trace's Skills block. That is the
      // observable difference the lesson's control experiment turns on.
      const linkedSkills = (await this.agents.linkedSkills(agent.id)).filter(
        (l) => l.skill.enabled,
      );
      const skillBodies = linkedSkills.map((l) => l.skill.body);
      runLog.info(
        linkedSkills.length > 0
          ? `skills: ${linkedSkills.length} attached (${linkedSkills.map((l) => l.skill.name).join(', ')})`
          : 'skills: none attached',
      );

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // The engine derives the verdict from the grounded findings under this
        // gate — the same policy `countBlockers` uses below, so the verdict and
        // the blocker count can never describe different findings.
        failOn: agent.ciFailOn,
        // Resolved skill bodies (NOT slugs) — the engine renders them as the
        // `## Skills / rules` section. Same omit-when-empty contract as below,
        // so an agent with no skills produces a byte-identical prompt to before.
        ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Derived intent & scope — same omit-when-empty contract, which is what
        // keeps every pre-intent prompt byte-identical when the classifier did
        // not run or failed.
        ...(intent ? { intent: intent.block } : {}),
        // Nothing may be deferred out of the score at a WARNING gate: a deferred
        // WARNING is 12 score points and, at ciFailOn 'warning', a CI gate flip.
        // The intent layer must never be able to turn a red gate green.
        allowDefer: agent.ciFailOn !== 'warning',
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      // `review.findings` is the ACTIVE set — grounded and in scope. It is what
      // score, verdict and blockers are derived from. Deferred findings are NOT
      // dropped: they are persisted alongside (flagged `out_of_scope`) so the
      // UI can show them, and only excluded from the derived numbers.
      const keptFindings = outcome.review.findings;
      const persistedFindings = [...keptFindings, ...outcome.deferred];

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, persistedFindings);
      runLog.result(
        `Persisted review ${review.id} with ${findingRows.length} finding(s)` +
          (outcome.deferred.length > 0 ? ` (${outcome.deferred.length} deferred as out of scope)` : ''),
      );

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: ONE run_traces document + run_skills, THEN the -----
      // ---- terminal status --------------------------------------------------
      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: keptFindings.length,
          grounding,
          // Intent-classifier usage, kept out of `cost_usd` on purpose: the
          // classifier runs once per REQUEST while {all: true} opens N runs, so
          // folding it into agent_runs.cost_usd would multiply one call's price
          // by N. Same numbers land in each trace — see the RunStats docblock.
          intent_tokens_in: intent?.tokensIn ?? null,
          intent_tokens_out: intent?.tokensOut ?? null,
          intent_cost_usd: intent?.costUsd ?? null,
          scope: outcome.scope,
        },
        prompt_assembly: {
          ...outcome.assembly,
          // What the skills block cost this prompt. Counted here rather than in
          // the engine because the tokenizer is a server adapter and
          // reviewer-core is pure.
          skills_tokens: outcome.assembly.skills
            ? this.container.tokenizer.count(outcome.assembly.skills)
            : null,
        },
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      // Which skills were actually in this prompt, and only those that really
      // made it in — this is what every per-skill stat is computed over. The
      // `agent_runs` FK target already exists: `runReview` INSERTs the row up
      // front and `completeAgentRun` only UPDATEs it.
      //
      // Best-effort ON PURPOSE: this is observability, not the result. The
      // review and its findings are already persisted, so letting an insert
      // failure fall through to the catch below would relabel a successful run
      // as 'failed'. The narrow real case is a skill deleted mid-run — its FK is
      // gone and the insert throws.
      try {
        await this.repo.saveRunSkills(
          runId,
          linkedSkills.map((l) => l.skill.id),
        );
      } catch (err) {
        runLog.info(`skills: could not record run_skills (${(err as Error).message})`);
      }

      // LAST, deliberately: a terminal status is the signal every reader polls
      // on (`waitForPrRuns`, the SSE client, the PR list), so it must not become
      // terminal until the trace and run_skills it implies are actually
      // committed. Setting it before those writes is a race a reader loses by
      // seeing 'done' next to a missing trace.
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        // The ACTIVE count, not `findingRows.length` — this number sits next to
        // `score` and `blockers` in the timeline, and all three must describe the
        // same set. Deferred findings are persisted but do not count here.
        findingsCount: keptFindings.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
      });
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Step 7 of the review sequence: reuse the stored classification when it was
   * derived for THIS head SHA by THIS model, else derive a fresh one and upsert
   * it.
   *
   * The reuse key is `head_sha` + `model` together. `head_sha` alone is not
   * enough — an intent derived by a different model is a different
   * classification, and switching the model in Settings must take effect. A
   * stale intent is a correctness bug here, not a cosmetic one: mis-scoping now
   * DEFERS findings.
   */
  private async deriveOrReuseIntent(
    workspaceId: string,
    pull: PullRow,
    repoRow: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<DerivedIntent> {
    const deps = this.intentDeps();
    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    const choice = await resolveIntentModel(deps, workspaceId);
    const modelId = `${choice.provider}/${choice.model}`;

    const stored = await this.repo.getIntent(pull.id);
    if (stored && stored.head_sha === pull.headSha && stored.model === modelId) {
      runLog.info(`intent: reusing stored classification for ${pull.headSha.slice(0, 8)}`);
      return {
        block: intentBlock(stored),
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
      };
    }

    const derived = await deriveIntent(deps, {
      workspaceId,
      pull,
      repoRef,
      diff,
      onNote: (msg) => runLog.info(msg),
    });

    await this.repo.upsertIntent(pull.id, {
      intent: derived.classification.intent,
      in_scope: derived.classification.in_scope,
      out_of_scope: derived.classification.out_of_scope,
      head_sha: pull.headSha,
      model: derived.model,
      confidence: derived.classification.confidence,
      sources: derived.classification.sources,
      missing_context: derived.classification.missing_context,
    });

    return {
      block: intentBlock(derived.classification),
      tokensIn: derived.tokensIn,
      tokensOut: derived.tokensOut,
      costUsd: derived.costUsd,
    };
  }

  /** Narrow dependency set for the classifier — not the whole Container. */
  private intentDeps(): IntentDeps {
    return intentDepsFrom(this.container, (workspaceId, key) =>
      this.repo.settingValue(workspaceId, key),
    );
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: {
        system: agent.systemPrompt,
        skills: null,
        skills_tokens: null,
        memory: null,
        specs: null,
        user: '',
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
