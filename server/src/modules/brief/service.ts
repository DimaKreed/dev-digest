import {
  FEATURE_MODELS,
  FeatureModelChoice,
  PrBrief,
  type BriefSource,
  type GitClient,
  type GitHubClient,
  type LLMProvider,
  type Provider,
  type RepoRef,
  type SecretsProvider,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  BRIEF_FEATURE_MODEL_ID,
  BRIEF_INPUT_TOKEN_CAP,
  BRIEF_MAX_RETRIES,
  BRIEF_TIMEOUT_MS,
  MAX_CONTEXT_DOCS,
  MAX_LINKED_ISSUES,
  SECRET_KEY_BY_PROVIDER,
} from './constants.js';
import {
  extractIssueRefs,
  fitToBudget,
  groundingFrom,
  summariseBlast,
  verifyRefs,
} from './helpers.js';
import {
  BRIEF_SCHEMA_NAME,
  PrBriefGeneration,
  type BriefContextDoc,
  type BriefContextReads,
  type BriefFacts,
  type BriefIntelReads,
  type BriefIssueFact,
  type BriefPull,
  type BriefPullReads,
  type BriefRepositoryPort,
} from './ports.js';

/**
 * PR brief use case (ring 2): what is risky about merging this pull request,
 * and which files to read first.
 *
 * Two entry points with deliberately different costs. `read` is pure I/O and
 * comparison — no model call, no write, no money (AC-14) — so opening the
 * Overview tab is free and a demo's call count stays deterministic. `generate`
 * makes EXACTLY one structured call (AC-01) and persists one document
 * (AC-18).
 *
 * Everything the repository under review supplies is DATA: it is wrapped as
 * untrusted in `helpers.ts` before it enters the model input, none of it
 * selects a code path here, and every path the model names is checked against
 * the input actually assembled before it can become a deep link (AC-13).
 *
 * The service takes a narrow deps object typed by ports (H7) and never sees the
 * `Container`.
 */

/** Per-request envelope for a generation. Not a shared contract. */
export interface BriefGenerateResult {
  brief: PrBrief;
  dropped_entries: number;
  degraded_sources: BriefSource[];
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
  };
}

/** Why the generate action is unavailable, or `null` when it is available. */
export type BriefUnavailableReason = 'missing_key';

/** Per-request envelope for a read. Makes no model call and writes nothing. */
export interface BriefReadResult {
  brief: PrBrief | null;
  generated_at: string | null;
  /** The pull request's head right now. The client compares nothing itself. */
  current_sha: string;
  /** Computed HERE (AC-16), never by the client. */
  stale: boolean;
  availability: {
    can_generate: boolean;
    reason: BriefUnavailableReason | null;
    provider: Provider;
    model: string;
  };
}

/**
 * Exactly what this service needs (H7), all of it a port, an adapter interface
 * or a plain value. Assembled in `routes.ts` from the container.
 */
export interface BriefDeps {
  brief: BriefRepositoryPort;
  pulls: BriefPullReads;
  intel: BriefIntelReads;
  context: BriefContextReads;
  /** Lazy: resolving a provider needs a key, and a brief may never be generated. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** Lazy for the same reason — an unlinked pull request never builds one. */
  github: () => Promise<GitHubClient>;
  git: GitClient;
  /** Key PRESENCE only — no value is ever read into a response. */
  secrets: SecretsProvider;
  /** The server-side counter AC-04's cap is enforced with. */
  tokenizer: { count(text: string): number };
  renderPrompt(name: string, vars: Record<string, string>): Promise<string>;
  /**
   * Whether repository intelligence is switched on at all.
   *
   * Passed in as a value because the flag is a configuration fact, not a port,
   * and because the facade cannot answer the question: `flag_off` is a declared
   * degraded reason that nothing in this codebase ever produces, so a disabled
   * layer is otherwise indistinguishable from an unindexed repo (AC-08).
   */
  repoIntelEnabled: boolean;
}

export class BriefService {
  /**
   * Pull requests with a generation in flight RIGHT NOW.
   *
   * An instance field, not a module-level singleton (M14): the guard's scope is
   * this app instance, and a shared module-level set would leak between the
   * apps a test suite builds.
   */
  private inFlight = new Set<string>();

  constructor(private deps: BriefDeps) {}

  // ---- read ----------------------------------------------------------------

  /**
   * The stored brief plus everything the card needs to be honest about it.
   *
   * Strictly I/O and comparison. No model call and no write (AC-14), and the
   * staleness comparison happens here so the client performs no sha or model
   * comparison of its own (AC-16).
   */
  async read(workspaceId: string, prId: string): Promise<BriefReadResult> {
    const pull = await this.mustGetPull(workspaceId, prId);
    const stored = await this.deps.brief.get(workspaceId, prId);
    const choice = await this.resolveModel(workspaceId);

    // AC-15 — reusable only on head sha AND model. Both are read off columns,
    // so answering this never deserialises the document.
    const stale = stored
      ? stored.headSha !== pull.headSha || stored.model !== choice.model
      : false;

    return {
      brief: stored ? parseStoredBrief(stored.json) : null,
      generated_at: stored ? stored.generatedAt.toISOString() : null,
      current_sha: pull.headSha,
      stale,
      availability: await this.availability(choice),
    };
  }

  // ---- generate ------------------------------------------------------------

  async generate(workspaceId: string, prId: string): Promise<BriefGenerateResult> {
    // AC-21 — check-and-add with NO await between them, so it is atomic on the
    // event loop. Testing the guard after an awaited lookup (as the intent
    // service used to) let two concurrent callers both pass the test and both
    // pay for a call.
    if (this.inFlight.has(prId)) {
      throw new AppError(
        'brief_in_flight',
        'A brief is already being generated for this pull request. Wait for it to finish rather than starting a second one.',
        409,
      );
    }
    this.inFlight.add(prId);
    try {
      return await this.generateNow(workspaceId, prId);
    } finally {
      this.inFlight.delete(prId);
    }
  }

  private async generateNow(workspaceId: string, prId: string): Promise<BriefGenerateResult> {
    // Workspace-scoped lookup FIRST — this is the authorization boundary, so a
    // pull request in another workspace must 404 here rather than leak its
    // title, its file paths or the fact that it exists (AC-22).
    const pull = await this.mustGetPull(workspaceId, prId);
    const choice = await this.resolveModel(workspaceId);

    // AC-24 — a paid route on an app advertised as booting with zero API keys
    // must say a key is required rather than look broken. `AppError` with a
    // feature-specific code and a 503, not a new error class: `ConfigError` is
    // a 500 and `platform/errors.ts` has no 503, and the onboarding service
    // already throws a bare `AppError` for exactly this kind of precondition.
    // The message names the PROVIDER, never the key's value or its absence
    // anywhere but here.
    const keyPresent = Boolean(await this.deps.secrets.get(SECRET_KEY_BY_PROVIDER[choice.provider]));
    if (!keyPresent) {
      throw new AppError(
        'missing_model_key',
        `No API key is configured for ${choice.provider}, so a brief cannot be generated. Add one in Settings and try again.`,
        503,
      );
    }

    // AC-20 — the head the input is assembled from, captured BEFORE the call.
    // If the pull request's head advances while the model is thinking, the
    // stored brief is still attributed to the head it actually described, and
    // therefore reads as stale against the new one under AC-15.
    const headSha = pull.headSha;

    const degraded: BriefSource[] = [];
    const facts = await this.gatherFacts(pull, degraded);

    // AC-04 / AC-05 — count with the server tokenizer, then drop in the fixed
    // order until it fits. The derived intent and the diff stats are not
    // members of `DROP_ORDER`, so they survive by construction.
    const fitted = fitToBudget(facts, (text) => this.deps.tokenizer.count(text), BRIEF_INPUT_TOKEN_CAP);
    for (const name of fitted.dropped) {
      // AC-06 — a dropped input is recorded by name, beside the absent ones.
      degraded.push({ name, reason: 'dropped_to_fit_token_budget' });
    }

    const system = await this.deps.renderPrompt('brief.system.md', {});

    // AC-01 — EXACTLY one structured call. `maxRetries` is the provider's own
    // retry of the same call, not a second call, and there is no fallback model.
    const llm = await this.deps.llm(choice.provider);
    const result = await llm.completeStructured<PrBriefGeneration>({
      model: choice.model,
      schemaName: BRIEF_SCHEMA_NAME,
      schema: PrBriefGeneration,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: fitted.payload },
      ],
      temperature: 0,
      timeoutMs: BRIEF_TIMEOUT_MS,
      maxRetries: BRIEF_MAX_RETRIES,
    });

    // AC-13 — grounded against the POST-drop fact set, so a document dropped to
    // fit the budget cannot ground a reference to itself.
    const verified = verifyRefs(result.data, groundingFrom(fitted.facts));

    const document: PrBrief = {
      risk_level: result.data.risk_level,
      what: result.data.what,
      why: result.data.why,
      risks: verified.risks,
      review_focus: verified.review_focus,
      // AC-09 — the document is self-describing once it leaves the database.
      head_sha: headSha,
      provider: choice.provider,
      model: choice.model,
      degraded_sources: degraded,
      dropped_entries: verified.dropped,
      // R1 — the brief's cost lives in the document and in this envelope, never
      // in `agent_runs.cost_usd`: a brief has no run, so that column is not
      // merely the wrong place, it is unreachable.
      usage: {
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      },
    };

    // AC-18 — one write of one document. Everything above can throw, and any
    // throw leaves the previously stored brief untouched (AC-19), because this
    // is the only statement that writes.
    await this.deps.brief.upsert(workspaceId, prId, {
      json: document,
      headSha,
      model: choice.model,
    });

    return {
      brief: document,
      dropped_entries: verified.dropped,
      degraded_sources: degraded,
      usage: {
        calls: 1,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      },
    };
  }

  // ---- fact gathering ------------------------------------------------------

  /**
   * Everything the brief is assembled from (AC-02) and nothing else. The
   * `patch` column is never read (AC-03).
   *
   * Every read is best-effort: a degraded or unreachable source is recorded by
   * name with a reason and the generation continues (AC-07). Generation is
   * never refused because a source is missing — a brief without blast is still
   * a brief.
   */
  private async gatherFacts(pull: BriefPull, degraded: BriefSource[]): Promise<BriefFacts> {
    const repo = await safely(() => this.deps.pulls.getRepo(pull.repoId), undefined);
    const repoFullName = repo ? `${repo.owner}/${repo.name}` : 'this repository';

    const [intent, files] = await Promise.all([
      safely(() => this.deps.pulls.getIntent(pull.id), undefined),
      safely(() => this.deps.pulls.getPrFiles(pull.id), [] as { path: string }[]),
    ]);
    if (!intent) {
      degraded.push({ name: 'derived_intent', reason: 'not_classified_yet' });
    }
    const changedFiles = files.map((f) => f.path);
    if (changedFiles.length === 0) {
      degraded.push({ name: 'changed_files', reason: 'no_files_recorded_for_this_pull_request' });
    }

    const [blastSummary, issues, contextDocs] = await Promise.all([
      this.blastSummary(pull.repoId, changedFiles, degraded),
      this.linkedIssues(pull, repo, degraded),
      this.contextDocuments(pull.repoId, repo, degraded),
    ]);

    return {
      repoFullName,
      prNumber: pull.number,
      title: pull.title,
      description: pull.body ?? '',
      intent: intent ?? null,
      diffStats: {
        filesChanged: pull.filesCount,
        additions: pull.additions,
        deletions: pull.deletions,
      },
      changedFiles,
      blastSummary,
      issues,
      contextDocs,
    };
  }

  /**
   * The one-paragraph blast summary, or `''` with a recorded reason.
   *
   * AC-08 — the flag being off is recorded as THIS source's reason, and it has
   * to be read off the config value: the facade short-circuits on the flag
   * before it reaches the point where it would stamp `flag_off`, so a disabled
   * layer otherwise arrives looking like empty data.
   */
  private async blastSummary(
    repoId: string,
    changedFiles: string[],
    degraded: BriefSource[],
  ): Promise<string> {
    if (!this.deps.repoIntelEnabled) {
      degraded.push({ name: 'blast_radius', reason: 'repo_intelligence_disabled_by_flag' });
      return '';
    }
    const read = await safely(
      async () => {
        const [blast, index] = await Promise.all([
          this.deps.intel.getBlastRadius(repoId, changedFiles),
          this.deps.intel.getIndexState(repoId),
        ]);
        return summariseBlast(blast, index);
      },
      null as string | null,
    );
    if (read === null) {
      degraded.push({ name: 'blast_radius', reason: 'repo_intelligence_unreachable' });
      return '';
    }
    if (read.length === 0) {
      degraded.push({ name: 'blast_radius', reason: 'no_usable_code_index_for_this_repository' });
      return '';
    }
    return read;
  }

  /**
   * The issues this pull request links, fetched from ITS OWN repository only.
   *
   * The same-repository restriction is a confused-deputy guard, not a
   * convenience: the PR body is written by whoever opened the pull request, so
   * a link to any other repository is an instruction from an untrusted party to
   * go and read something. It is recorded as not followed rather than followed.
   */
  private async linkedIssues(
    pull: BriefPull,
    repo: { owner: string; name: string } | undefined,
    degraded: BriefSource[],
  ): Promise<BriefIssueFact[]> {
    if (!repo) return [];
    const text = `${pull.title}\n\n${pull.body ?? ''}`;
    const sameRepo = (r: { owner: string; name: string }) =>
      r.owner.toLowerCase() === repo.owner.toLowerCase() &&
      r.name.toLowerCase() === repo.name.toLowerCase();

    const all = extractIssueRefs(text, repo);
    for (const ref of all.filter((r) => !sameRepo(r))) {
      degraded.push({ name: 'linked_issue', reason: `external_link_not_followed:${ref.ref}` });
    }

    const out: BriefIssueFact[] = [];
    const ownRef: RepoRef = { owner: repo.owner, name: repo.name };
    for (const ref of all.filter(sameRepo).slice(0, MAX_LINKED_ISSUES)) {
      try {
        const github = await this.deps.github();
        const issue = await github.getIssue(ownRef, ref.number);
        out.push({ ref: ref.ref, title: issue.title, body: issue.body ?? '' });
      } catch {
        degraded.push({ name: 'linked_issue', reason: `unreachable:${ref.ref}` });
      }
    }
    return out;
  }

  /**
   * The repository's attached project-context documents, read fresh out of the
   * clone. Attachments store PATHS and never text (SPEC-01), so the text is a
   * separate read and a deleted document is a recorded absence, not a failure.
   */
  private async contextDocuments(
    repoId: string,
    repo: { owner: string; name: string } | undefined,
    degraded: BriefSource[],
  ): Promise<BriefContextDoc[]> {
    if (!repo) {
      degraded.push({ name: 'project_context', reason: 'owning_repository_could_not_be_resolved' });
      return [];
    }
    const attached = await safely(
      () => this.deps.context.attachCountsByPath(repoId),
      null as { path: string; count: number }[] | null,
    );
    if (attached === null) {
      degraded.push({ name: 'project_context', reason: 'attachments_unreadable' });
      return [];
    }
    // AC-07 — an ABSENT source is recorded too, not silently skipped. "The
    // brief was written without any project context" and "this repository has
    // no project context to write it from" are the same sentence to the reader,
    // and both are things they need in order to weigh the brief's confidence.
    if (attached.length === 0) {
      degraded.push({
        name: 'project_context',
        reason: 'no_documents_attached_to_this_repository',
      });
      return [];
    }

    // Most-attached first: the document the most agents rely on is the one most
    // likely to matter, and the cap has to cut somewhere deterministic.
    const ordered = [...attached]
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, MAX_CONTEXT_DOCS);

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const out: BriefContextDoc[] = [];
    for (const row of ordered) {
      try {
        out.push({ path: row.path, text: await this.deps.git.readFile(ref, row.path) });
      } catch {
        degraded.push({ name: 'project_context', reason: `unreadable:${row.path}` });
      }
    }
    return out;
  }

  // ---- internals -----------------------------------------------------------

  private async mustGetPull(workspaceId: string, prId: string): Promise<BriefPull> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  /**
   * Is the generate action offered at all, and if not, why.
   *
   * The key is only ever tested for PRESENCE. No secret value leaves this
   * method, and the provider name that does is the resolved choice, not
   * anything the caller supplied.
   */
  private async availability(choice: FeatureModelChoice): Promise<BriefReadResult['availability']> {
    const configured = Boolean(
      await this.deps.secrets.get(SECRET_KEY_BY_PROVIDER[choice.provider]),
    );
    return {
      can_generate: configured,
      reason: configured ? null : 'missing_key',
      provider: choice.provider,
      model: choice.model,
    };
  }

  /**
   * Provider+model for this brief: the workspace's `feature_models.risk_brief`
   * override, else the registry default.
   *
   * This duplicates the settings module's own resolver deliberately — the
   * `no-cross-module` arch rule forbids importing it, and reading the `settings`
   * TABLE through this module's own port is the legal equivalent. The blast
   * notes service and the conventions service carry the same duplication for
   * the same reason, and blast reads the SAME `risk_brief` id: the coupling is
   * known and left in place, because un-sharing it means a new registry id in
   * both `contracts/platform.ts` copies plus a settings-UI change.
   */
  private async resolveModel(workspaceId: string): Promise<FeatureModelChoice> {
    const fallback = FEATURE_MODELS.find((f) => f.id === BRIEF_FEATURE_MODEL_ID);
    const raw = await this.deps.pulls.settingValue(workspaceId, 'feature_models');
    const chosen = (raw as Record<string, unknown> | null | undefined)?.[BRIEF_FEATURE_MODEL_ID];
    const parsed = FeatureModelChoice.safeParse(chosen);
    if (parsed.success) return parsed.data;
    if (!fallback) {
      throw new AppError(
        'brief_model_unregistered',
        `No model is registered for the "${BRIEF_FEATURE_MODEL_ID}" feature.`,
        500,
      );
    }
    return { provider: fallback.defaultProvider, model: fallback.defaultModel };
  }
}

/**
 * A stored document is jsonb, so it may predate any field this feature adds
 * later (AC-12). `safeParse` also keeps an unreadable row from taking the whole
 * page down — an undisplayable brief reads as "no brief", which the empty state
 * already covers.
 */
function parseStoredBrief(json: unknown): PrBrief | null {
  const parsed = PrBrief.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Best-effort read: a degraded source is an absent claim, never a thrown request. */
async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}
