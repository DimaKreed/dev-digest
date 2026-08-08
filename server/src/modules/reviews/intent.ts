import type {
  GitClient,
  GitHubClient,
  IntentClassification as IntentClassificationT,
  IntentSource,
  LLMProvider,
  Provider,
  RepoRef,
  UnifiedDiff,
} from '@devdigest/shared';
import { FEATURE_MODELS, FeatureModelChoice, IntentClassification } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { renderPrompt } from '../../platform/prompts.js';
import type { IntentPull } from './ports.js';
import {
  INTENT_MAX_LINKED_ISSUES,
  INTENT_MAX_REPO_FILES,
  INTENT_MAX_RETRIES,
  INTENT_MAX_SOURCE_CHARS,
  INTENT_TIMEOUT_MS,
} from './constants.js';

/**
 * PR-intent derivation — the cheap classification pass that runs BEFORE a
 * review and tells the reviewer what the PR set out to do.
 *
 * Five sources, all local or already-authenticated (§1 of the plan): PR title,
 * PR body, the changed-file list with hunk headers, a linked GitHub issue/PR,
 * and an in-repo plan/spec file. **Diff BODIES are never sent** — only paths,
 * counts and `@@` headers.
 *
 * Any other link found in the PR text is deliberately NOT fetched. An
 * SSRF-guarded `HttpFetcher` port exists (`vendor/shared/adapters.ts`, tested by
 * `test/http-fetcher-ssrf.test.ts`) and declining to use it is a decision, not
 * an oversight: an arbitrary outbound fetch driven by PR body text is a much
 * larger surface than this feature needs. Unfetched links are recorded in
 * `missing_context` and lower the classifier's confidence instead.
 */

// ============================================================== pure helpers

/**
 * Normalise a repo-relative path taken out of attacker-influenced PR text, or
 * return null if it escapes the repo root.
 *
 * This is the one new request-input → filesystem path in the Intent Layer:
 * `git.readFile` would otherwise take a path straight from a PR body. Rejects
 * absolute paths, Windows drive letters and UNC prefixes, backslashes, URL
 * schemes, NUL bytes, and any `..` segment — before rather than after
 * normalisation, so `a/../../etc/passwd` cannot collapse into an escape.
 */
export function safeRepoPath(raw: string): string | null {
  const path = raw.trim();
  if (path.length === 0 || path.length > 200) return null;
  if (path.includes('\0') || path.includes('\\')) return null;
  if (path.startsWith('/') || path.startsWith('~')) return null;
  if (/^[A-Za-z]:/.test(path)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) return null;

  const segments = path.split('/');
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    kept.push(segment);
  }
  if (kept.length === 0) return null;
  return kept.join('/');
}

/** `#123` and `github.com/<owner>/<repo>/(issues|pull)/123` references. */
export function extractIssueRefs(
  text: string,
  self: RepoRef,
): { owner: string; name: string; number: number; ref: string }[] {
  const out: { owner: string; name: string; number: number; ref: string }[] = [];
  const seen = new Set<string>();
  const push = (owner: string, name: string, number: number, ref: string) => {
    const key = `${owner}/${name}#${number}`;
    if (seen.has(key) || Number.isNaN(number) || number <= 0) return;
    seen.add(key);
    out.push({ owner, name, number, ref });
  };

  const urlRe =
    /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g;
  for (const m of text.matchAll(urlRe)) {
    push(m[1]!, m[2]!, Number(m[3]), m[0]!);
  }
  // Bare `#123` always means this repo.
  for (const m of text.matchAll(/(?:^|[^\w/#])#(\d+)\b/g)) {
    push(self.owner, self.name, Number(m[1]), `#${m[1]}`);
  }
  return out;
}

/** Path-like `.md` tokens (`docs/plan.md`, `SPEC.md`) mentioned in the PR text. */
export function extractRepoFilePaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // The leading lookbehind is what rejects a traversal: in `../../etc/plan.md`
  // every candidate start is preceded by `/` or `.`, so nothing matches. The
  // trailing lookahead deliberately allows a following `.` — "read SPEC.md." is
  // ordinary prose, and excluding it silently dropped the commonest phrasing.
  for (const m of text.matchAll(/(?<![\w/.-])((?:[\w-]+\/)*[\w.-]+\.(?:md|mdx))(?![\w/-])/g)) {
    const safe = safeRepoPath(m[1]!);
    if (safe && !seen.has(safe)) {
      seen.add(safe);
      out.push(safe);
    }
  }
  return out;
}

/** Links the classifier is NOT allowed to follow (decision B). */
export function extractUnfetchableLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>()[\]]+/g)) {
    const url = m[0]!.replace(/[.,;:]+$/, '');
    if (/^https?:\/\/(?:www\.)?github\.com\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * The changed-file block: one line per file with its +/- counts, then one
 * synthesised `@@` header per hunk. Hunk CONTENTS are never included — the
 * classifier is told what moved and where, never what the code says.
 */
export function fileListBlock(diff: UnifiedDiff): string {
  const lines: string[] = [];
  for (const f of diff.files) {
    lines.push(`${f.path} (+${f.additions}/-${f.deletions})`);
    for (const h of f.hunks) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
  }
  return lines.join('\n');
}

function truncate(text: string): string {
  return text.length > INTENT_MAX_SOURCE_CHARS
    ? `${text.slice(0, INTENT_MAX_SOURCE_CHARS)}\n…[truncated]`
    : text;
}

/**
 * Render a stored classification into the block injected into the reviewer
 * prompt. Plain text, no JSON — the reviewer reads it as prose inside
 * `<untrusted source="intent">`.
 */
export function intentBlock(c: {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence?: number | null;
  missing_context?: string[] | null;
}): string {
  const lines = [`Intent: ${c.intent}`];
  lines.push('In scope:');
  for (const s of c.in_scope) lines.push(`- ${s}`);
  if (c.in_scope.length === 0) lines.push('- (nothing stated)');
  lines.push('Out of scope (the author excluded these):');
  for (const s of c.out_of_scope) lines.push(`- ${s}`);
  if (c.out_of_scope.length === 0) lines.push('- (nothing stated)');
  if (typeof c.confidence === 'number') {
    lines.push(`Classifier confidence: ${c.confidence.toFixed(2)}`);
  }
  if (c.missing_context && c.missing_context.length > 0) {
    lines.push('Context the classifier could not reach:');
    for (const s of c.missing_context) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}

// ============================================================== the use case

/**
 * Narrow dependency set for the classifier — deliberately NOT the whole
 * `Container` (H-rule: inject what you call). `settingValue` is this module's
 * own repository read, not `modules/settings`.
 */
export interface IntentDeps {
  /** Lazy: resolving it throws when GITHUB_TOKEN is absent, and a missing token
      must degrade to `missing_context`, not fail the whole classification. */
  github: () => Promise<GitHubClient>;
  git: GitClient;
  llm: (provider: Provider) => Promise<LLMProvider>;
  tokenizer: { count(text: string): number };
  settingValue: (workspaceId: string, key: string) => Promise<unknown>;
}

/**
 * Build the classifier's dependency set from the composition root. One place,
 * so the run-executor's pre-work path and the HTTP endpoints cannot drift apart
 * (e.g. one of them reading a different settings row).
 */
export function intentDepsFrom(
  container: {
    github: () => Promise<GitHubClient>;
    git: GitClient;
    llm: (id: Provider) => Promise<LLMProvider>;
    tokenizer: { count(text: string): number };
  },
  settingValue: (workspaceId: string, key: string) => Promise<unknown>,
): IntentDeps {
  return {
    github: () => container.github(),
    git: container.git,
    llm: (provider) => container.llm(provider),
    tokenizer: container.tokenizer,
    settingValue,
  };
}

export interface IntentDerivation {
  classification: IntentClassificationT;
  /** `<provider>/<model>` — the reuse key, alongside `head_sha`. */
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Provider+model for the classifier: the workspace's
 * `feature_models.review_intent` override, else the registry default.
 *
 * Duplicated from `modules/settings/feature-models.ts` on purpose — the
 * `no-cross-module` arch rule forbids `modules/reviews` importing it, and
 * reading the `settings` table through this module's own repository is the
 * legal equivalent. Mirrors `ConventionsService.resolveModel`.
 */
export async function resolveIntentModel(
  deps: Pick<IntentDeps, 'settingValue'>,
  workspaceId: string,
): Promise<FeatureModelChoice> {
  const fallback = FEATURE_MODELS.find((f) => f.id === 'review_intent')!;
  const raw = await deps.settingValue(workspaceId, 'feature_models');
  const chosen = (raw as Record<string, unknown> | null | undefined)?.['review_intent'];
  const parsed = FeatureModelChoice.safeParse(chosen);
  return parsed.success
    ? parsed.data
    : { provider: fallback.defaultProvider, model: fallback.defaultModel };
}

export interface GatheredSources {
  user: string;
  sources: IntentSource[];
  missing: string[];
}

/** Assemble the classifier's user message from the five permitted sources. */
export async function gatherSources(
  deps: Pick<IntentDeps, 'github' | 'git'>,
  args: { pull: IntentPull; repoRef: RepoRef; diff: UnifiedDiff; onNote?: (msg: string) => void },
): Promise<GatheredSources> {
  const { pull, repoRef, diff } = args;
  const sources: IntentSource[] = [];
  const missing: string[] = [];
  const sections: string[] = [];

  sources.push({ kind: 'pr_title', ref: `#${pull.number}` });
  sections.push(`## PR title\n${wrapUntrusted('pr-title', pull.title)}`);

  const body = pull.body?.trim() ?? '';
  if (body.length > 0) {
    sources.push({ kind: 'pr_body', ref: `#${pull.number}` });
    sections.push(`## PR description\n${wrapUntrusted('pr-body', truncate(body))}`);
  } else {
    missing.push('empty PR description');
  }

  sources.push({ kind: 'file_list', ref: `${diff.files.length} changed file(s)` });
  sections.push(`## Changed files (paths and hunk headers only)\n${wrapUntrusted('file-list', fileListBlock(diff))}`);

  const text = `${pull.title}\n${body}`;

  // Linked GitHub issues / PRs. Only the GitHub API, only through the existing
  // authenticated client — never an arbitrary fetch.
  //
  // CONFINED TO THIS PR'S OWN REPO. A `github.com/<owner>/<repo>/issues/N` URL in
  // an attacker-authored PR body would otherwise make us read that repo with the
  // operator's workspace-wide token and ship its contents to a third-party model
  // provider — a confused deputy, plus an access oracle via `sources` /
  // `missing_context`. Bare `#123` was already pinned to self by extractIssueRefs.
  const sameRepo = (r: { owner: string; name: string }) =>
    r.owner.toLowerCase() === repoRef.owner.toLowerCase() &&
    r.name.toLowerCase() === repoRef.name.toLowerCase();

  const allRefs = extractIssueRefs(text, repoRef);
  for (const ref of allRefs.filter((r) => !sameRepo(r))) {
    missing.push(`external issue link not followed: ${ref.ref}`);
  }

  for (const ref of allRefs.filter(sameRepo).slice(0, INTENT_MAX_LINKED_ISSUES)) {
    try {
      const github = await deps.github();
      const issue = await github.getIssue({ owner: ref.owner, name: ref.name }, ref.number);
      sources.push({ kind: 'github_issue', ref: ref.ref });
      // The TITLE goes INSIDE the wrapper with the body. `wrapUntrusted` escapes
      // `</untrusted>` only within what it wraps, so a title interpolated into the
      // header would be unescaped attacker text sitting in structural position —
      // and `intent.system.md`'s guard scopes itself to what is inside the blocks.
      // `ref.ref` is safe in the header: it is our own reconstruction, not raw input.
      sections.push(
        `## Linked issue ${ref.ref}\n${wrapUntrusted(
          'github-issue',
          truncate(`${issue.title}\n\n${issue.body ?? ''}`),
        )}`,
      );
    } catch (err) {
      missing.push(`linked issue ${ref.ref} could not be fetched (${(err as Error).message})`);
      args.onNote?.(`intent: source unreachable — ${ref.ref} (recorded in missing_context)`);
    }
  }

  // In-repo plan / spec files named in the PR text. Every path goes through
  // safeRepoPath first (extractRepoFilePaths already applies it) and each read
  // is individually try/caught — a missing file is context, never a failure.
  for (const path of extractRepoFilePaths(text).slice(0, INTENT_MAX_REPO_FILES)) {
    try {
      const content = await deps.git.readFile(repoRef, path);
      if (content.trim().length === 0) {
        missing.push(`in-repo file ${path} is empty`);
        continue;
      }
      sources.push({ kind: 'repo_file', ref: path });
      sections.push(`## In-repo plan/spec: ${path}\n${wrapUntrusted('repo-file', truncate(content))}`);
    } catch {
      missing.push(`in-repo file ${path} could not be read`);
      args.onNote?.(`intent: source unreachable — ${path} (recorded in missing_context)`);
    }
  }

  for (const url of extractUnfetchableLinks(text)) {
    missing.push(`external link not followed: ${url}`);
  }

  // Wrapped too: these lines carry attacker-supplied URLs and raw provider error
  // text, so they are untrusted content despite being assembled by us.
  if (missing.length > 0) {
    sections.push(
      `## Context that was NOT available\n${wrapUntrusted(
        'missing-context',
        missing.map((m) => `- ${m}`).join('\n'),
      )}`,
    );
  }

  return { user: sections.join('\n\n'), sources, missing };
}

/**
 * Derive the intent for one PR: gather sources → one cheap structured LLM call.
 *
 * Throws on any failure. Every caller treats intent as ENRICHMENT and catches:
 * failing a review over an optional classification would regress behaviour that
 * works today.
 */
export async function deriveIntent(
  deps: IntentDeps,
  args: {
    workspaceId: string;
    pull: IntentPull;
    repoRef: RepoRef;
    diff: UnifiedDiff;
    /** Live-log sink; receives one line per notable step. No secrets, no bodies. */
    onNote?: (msg: string) => void;
  },
): Promise<IntentDerivation> {
  const choice = await resolveIntentModel(deps, args.workspaceId);
  const gathered = await gatherSources(deps, args);

  const system = await renderPrompt('intent.system.md', {
    repo: `${args.repoRef.owner}/${args.repoRef.name}`,
    number: String(args.pull.number),
  });

  const promptParts = gathered.sources.map((s) => s.ref).join(',');
  args.onNote?.(
    `intent: model=${choice.provider}/${choice.model}, prompt_parts=[${promptParts}], ` +
      `est_tokens=${deps.tokenizer.count(`${system}\n${gathered.user}`)}, sources=${gathered.sources.length}`,
  );

  const llm = await deps.llm(choice.provider);
  const res = await llm.completeStructured<IntentClassificationT>({
    model: choice.model,
    schema: IntentClassification,
    // The schema name is the seam that tells the two structured calls of a run
    // apart — MockLLMProvider.structuredBySchema keys on it, and so does the
    // trace reader. Never reuse 'Review' here.
    schemaName: 'IntentClassification',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: gathered.user },
    ],
    temperature: 0,
    timeoutMs: INTENT_TIMEOUT_MS,
    maxRetries: INTENT_MAX_RETRIES,
  });

  // The classifier's own `sources` / `missing_context` are model output; the
  // gathered ones are FACTS. Union them, with ours winning on duplicates, so a
  // hallucinated source cannot displace the real record of what was read.
  const classification: IntentClassificationT = {
    ...res.data,
    sources: gathered.sources,
    missing_context: [
      ...gathered.missing,
      ...res.data.missing_context.filter((m) => !gathered.missing.includes(m)),
    ],
  };

  args.onNote?.(
    `intent: derived — confidence=${classification.confidence.toFixed(2)}, ` +
      `in_scope=${classification.in_scope.length}, out_of_scope=${classification.out_of_scope.length}, ` +
      `missing_context=${classification.missing_context.length}`,
  );

  return {
    classification,
    model: `${choice.provider}/${choice.model}`,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
