import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// `imported_file` = uploaded .md or .zip; `imported_url` = fetched from a URL.
// NOTE: the DB column is plain `text` (Drizzle's `enum` option is TS-level only,
// it emits no CHECK), so adding a value here needs no migration.
export const SkillSource = z.enum([
  'manual',
  'imported_url',
  'imported_file',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /** Token cost of `body`, counted server-side. The client has no tokenizer. */
  tokens: z.number().int(),
  /** How many agents link this skill (COUNT over agent_skills). */
  used_by: z.number().int(),
});
export type Skill = z.infer<typeof Skill>;

/** One immutable body snapshot. `note` is the author's "what changed" label. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  note: z.string().nullish(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * Per-skill rollup. Every run-derived number is scoped to runs where this skill
 * was actually in the prompt (`run_skills`) — a single finding is NOT
 * attributable to a single skill, since one run concatenates N skill bodies.
 */
export const SkillStats = z.object({
  used_by: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  runs_pulled: z.number().int(),
  findings_30d: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  /** accepted / (accepted + dismissed); null when nothing has been triaged. */
  accept_rate: z.number().nullable(),
  findings_by_category: z.array(
    z.object({ category: z.string(), count: z.number().int() }),
  ),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * Verdict of the prompt-injection scan run over an imported skill body.
 *
 * An imported skill is a stranger's text that will be concatenated into a
 * reviewer's prompt, so it is classified BEFORE the user is offered a save
 * button. The classifier only ever labels — it never follows what it reads, and
 * the body reaches it wrapped in `<untrusted>`.
 */
export const SkillSafetyCategory = z.enum([
  /** "ignore previous instructions", "you are now …", role/scope overrides */
  'instruction_override',
  /** asks to send repo content, diffs or findings somewhere */
  'exfiltration',
  /** asks to run commands, fetch URLs, or touch the filesystem */
  'tool_abuse',
  /** asks for keys, tokens, env vars or other secrets */
  'secret_request',
  /** base64/homoglyph/zero-width padding hiding the real payload */
  'obfuscation',
  /** not a review rule at all — off-topic filler */
  'off_topic',
]);
export type SkillSafetyCategory = z.infer<typeof SkillSafetyCategory>;

export const SkillSafetyVerdict = z.object({
  verdict: z.enum(['safe', 'suspicious', 'unsafe']),
  summary: z.string(),
  reasons: z.array(
    z.object({
      /** Verbatim excerpt from the body, so the user can judge for themselves. */
      quote: z.string(),
      category: SkillSafetyCategory,
    }),
  ),
});
export type SkillSafetyVerdict = z.infer<typeof SkillSafetyVerdict>;

/**
 * What an uploaded .md/.zip — or a fetched URL — yields BEFORE anything is
 * written. The import routes that produce this perform no writes at all —
 * saving is a separate, explicit POST /skills after the user has read the body.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  tokens: z.number().int(),
  /** Which archive entry the body came from, e.g. "SKILL.md". */
  source_file: z.string(),
  /**
   * Archive entries that did NOT become the body:
   *  - `executable`       — never decompressed, never read, never run
   *  - `not_markdown`     — not decompressed either (only .md is read)
   *  - `unused_markdown`  — markdown, but a different entry was chosen
   */
  skipped: z.array(
    z.object({
      path: z.string(),
      reason: z.enum(['executable', 'not_markdown', 'unused_markdown']),
    }),
  ),
  /**
   * Null when the scan could not run (no provider key configured). The app boots
   * with zero API keys, so "unscanned" is a real state the UI must show as such
   * rather than silently presenting an unchecked body as clean.
   */
  safety: SkillSafetyVerdict.nullish(),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----

/** Triage state. Only `accepted` candidates are merged into a generated skill. */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

// Fixed taxonomy — the extractor prompt offers exactly these and nothing else,
// so the model cannot invent a category and the UI can style each one. The DB
// column is plain `text` (Drizzle's `enum` emits no CHECK), so widening this
// needs no migration — but it DOES need the same edit in the other copy of
// vendor/shared and in db/schema/knowledge.ts.
export const ConventionCategory = z.enum([
  'naming',
  'error-handling',
  'async',
  'imports',
  'structure',
  'api-design',
  'testing',
  'typing',
  'logging',
  'data-access',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * A house-rule candidate whose evidence has already survived code verification.
 *
 * Everything here is grounded: the model proposes, but a candidate only reaches
 * the client once the server has opened each cited file in the clone and matched
 * the snippet verbatim (modulo whitespace). `occurrences` is therefore a COUNTED
 * fact, not a model estimate — and it is always >= 2, because a pattern seen in
 * one file is a coincidence rather than a convention.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  category: ConventionCategory,
  /** Primary (first verified) occurrence — what the card shows and links to. */
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  /** Real 1-based lines, recomputed from the match — not the model's guess. */
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  /** Every verified path, primary first. Length === `occurrences`. */
  evidence_files: z.array(z.string()),
  occurrences: z.number().int().min(2),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  /** Set once this candidate has been merged into a generated skill. */
  skill_id: z.string().nullable(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/**
 * The extractor's own scorecard for one scan. Published so the UI (and the
 * write-up) can show how much the model proposed versus how much survived
 * verification — the drop reasons are the honest quality signal.
 */
export const ExtractionStats = z.object({
  sampled_files: z.number().int(),
  config_files: z.array(z.string()),
  proposed: z.number().int(),
  verified: z.number().int(),
  /** Cited a path we never sampled — a hallucinated file. */
  dropped_no_file: z.number().int(),
  /** File existed, but the quoted snippet is not in it. */
  dropped_no_snippet: z.number().int(),
  /** Verified, but in fewer than two distinct files. */
  dropped_single_occurrence: z.number().int(),
  /** Survived verification, but you have already accepted or rejected it. */
  suppressed: z.number().int(),
  provider: z.string(),
  model: z.string(),
  cost_usd: z.number(),
});
export type ExtractionStats = z.infer<typeof ExtractionStats>;

/**
 * Merged markdown for the skill the accepted candidates would become, rendered
 * server-side but written NOWHERE. The client shows it in an editable modal and
 * then POSTs to the normal POST /skills — which is what keeps the conventions
 * module free of any dependency on the skills module.
 */
export const SkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: z.literal('convention'),
  body: z.string(),
  evidence_files: z.array(z.string()),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;
