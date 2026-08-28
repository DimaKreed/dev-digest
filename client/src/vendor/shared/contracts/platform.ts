import { z } from 'zod';
import { Provider } from './knowledge.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    // Cheap by design: the classifier reads only PR title/body, a linked issue,
    // an in-repo plan and the changed-file list — never diff bodies — and its
    // output is a short structured label, not a judgement about code. It also
    // runs on the critical path of every review, so a slow expensive model here
    // delays the first agent for no gain. Matches `conventions` / `onboarding`.
    //
    // This default is mirrored in THREE places: this file, its client copy, and
    // `client/src/lib/feature-models.ts` (the client cannot import a runtime
    // value out of vendor/shared). Change all three or the Settings picker
    // advertises a default the server does not use.
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    // Cheap by design: extraction is one call over a dozen sampled files, and
    // every rule it proposes is verified against the real code afterwards, so
    // model precision matters far less here than it does for a review. Matches
    // `onboarding`, the other whole-repo scan, and the seeded workspace default.
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /**
   * Derive a PR's intent automatically when its page is opened, once per head
   * SHA. OFF by default on purpose: it spends money on a GET, so the capability
   * ships dormant and a fresh install pays nothing until the user opts in. With
   * it off the intent is still derived as pre-work inside an explicit review run.
   */
  auto_derive_intent: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // Severity breakdown over the latest review of EACH agent, dismissed
  // findings excluded — the same formula the PR detail header's counters use,
  // so the two surfaces agree. List endpoint only; null until reviewed.
  findings_critical: z.number().int().nullish(),
  findings_warning: z.number().int().nullish(),
  findings_suggestion: z.number().int().nullish(),
  // Dollar cost of the latest COMPLETED run (list endpoint only; null until a
  // run finishes, or when the provider/price book couldn't price it).
  cost_usd: z.number().nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
/**
 * The type badge a document carries: the matched search root's own directory
 * name, verbatim.
 *
 * Deliberately OPEN, not an enum. The search roots are configurable, so a
 * closed vocabulary collapsed every non-default root onto one fallback value
 * and made `adr/` indistinguishable from `rfc/` — two different roots must
 * never display the same type. It follows that this string is DATA, not copy:
 * the client renders it as it arrives and does not route it through a
 * translation key, the same rule the interpolated root list already follows.
 *
 * (The closed-vocabulary rule in the root `CLAUDE.md` covers `Severity` and
 * `Verdict` only; it does not reach this type.)
 */
export const ContextDocType = z.string();
export type ContextDocType = z.infer<typeof ContextDocType>;

/**
 * Why a discovered document cannot be attached. An ENUM, not a message: the
 * per-file byte ceiling is a server-side number and must not travel to the
 * client, so the server states the VERDICT and the UI owns the wording.
 */
export const NotAttachableReason = z.enum(['too_large']);
export type NotAttachableReason = z.infer<typeof NotAttachableReason>;

/**
 * One repository markdown document, as discovered on the Project Context page.
 *
 * Every field added past `updated_at` is `.nullish()` so anything that parses
 * this contract today keeps parsing. `tokens` is counted server-side by the
 * tokenizer adapter — the client counts none of its own (and `content` is
 * populated only by the single-file preview endpoint).
 */
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
  /** Directory the document lives in; `'.'` at the clone root. */
  dir: z.string().nullish(),
  /**
   * The document's displayed type: the directory name of the search root that
   * matched it.
   *
   * Carried here even though `ContextSearchRoot` carries no such field, and the
   * asymmetry is the point: for a ROOT the type was the root's own name, so
   * there was nothing to tell the client. For a DOCUMENT it is information the
   * client cannot derive at all — given `specs/api/public.md` it does not know
   * which configured root matched, nor how many path segments that root spanned.
   */
  doc_type: ContextDocType.nullish(),
  tokens: z.number().int().nullish(),
  /** How many AGENTS in this workspace attach this document for this repo. */
  used_by: z.number().int().nullish(),
  attachable: z.boolean().nullish(),
  not_attachable_reason: NotAttachableReason.nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

/**
 * One configured project-context search root, as the server TELLS the client.
 *
 * The client is told which directories were searched rather than deriving or
 * hardcoding them — the same rule that keeps token counting server-side. The
 * per-file byte ceiling is deliberately NOT here: the threshold stays a
 * server-side number, and a document over it is reported as a verdict
 * (`attachable` + `not_attachable_reason`), never as a size to compare against.
 */
export const ContextSearchRoot = z.object({
  /**
   * Clone-relative directory name, e.g. `specs` — and, by AC-41, the displayed
   * type of every document matched under it.
   *
   * There is deliberately NO second field carrying that type. It would ship the
   * same value twice, and a contract that does invites drift: sooner or later
   * one field is updated and the other is not. This file is duplicated into
   * `client/src/vendor/shared/`, so that day would pass quietly in two places
   * at once. A consumer that wants the badge for a root reads `dir`.
   */
  dir: z.string(),
});
export type ContextSearchRoot = z.infer<typeof ContextSearchRoot>;

/**
 * One entry of an agent's or skill's attachment set. Paths + order only: no
 * text, no size and no snapshot, because the document is read fresh from the
 * clone on every run.
 */
export const ContextAttachment = z.object({
  path: z.string(),
  order: z.number().int(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/**
 * The WHOLE ordered set, sent in one request. Position in `paths` IS the
 * injection order, so a reorder and an attach are the same call.
 */
export const SetContextBody = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string()).max(200),
});
export type SetContextBody = z.infer<typeof SetContextBody>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
