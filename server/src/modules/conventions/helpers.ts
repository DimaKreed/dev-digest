import type { ConventionCandidate, SkillDraft } from '@devdigest/shared';
import type { ConventionRow } from './ports.js';
import {
  MAX_CONFIG_FILE_CHARS,
  MAX_FILE_CHARS,
  MAX_PAYLOAD_CHARS,
  MAX_REPO_MAP_CHARS,
} from './constants.js';

/**
 * Pure helpers for the conventions module: prompt assembly, the code-only
 * evidence verifier, and row ⇄ DTO / skill-draft rendering.
 *
 * No I/O — nothing here touches the DB, the filesystem or an adapter (arch rule
 * `c5-pure-helpers`). That is deliberate: `verifyEvidence` is the gate the whole
 * feature rests on, so it has to be testable without Docker, a clone or a model.
 */

// ---------------------------------------------------------------------------
// Config files
// ---------------------------------------------------------------------------

/**
 * Project config files fed to the extractor alongside the code samples.
 *
 * They must be listed SEPARATELY because `repoIntel.getConventionSamples()`
 * deliberately filters config files OUT of its rank-driven sample (see
 * `JUNK_PATH_PATTERNS` in `modules/repo-intel/service.ts`). Codified rules
 * (tsconfig strictness, lint config, formatting) are exactly the context that
 * stops the model proposing a "convention" the tooling already enforces.
 */
export const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'biome.json',
  '.editorconfig',
] as const;

// ---------------------------------------------------------------------------
// Prompt payload
// ---------------------------------------------------------------------------

/** One file as it goes into the prompt: repo-relative path + raw text. */
export interface SampleFile {
  path: string;
  text: string;
}

export interface SamplePayloadInput {
  files: SampleFile[];
  configs: SampleFile[];
  repoMap: string;
}

/**
 * Render a file with 1-based line numbers, truncating the TAIL only so every
 * number the model can read is the number the file really has. That is what
 * lets the model cite `path:line` — and what makes a citation checkable.
 */
function withLineNumbers(text: string, maxChars: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const width = String(lines.length).length;
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const rendered = `${String(i + 1).padStart(width, ' ')} | ${lines[i] ?? ''}`;
    if (used + rendered.length > maxChars) {
      out.push(`… (truncated after ${i} lines)`);
      break;
    }
    out.push(rendered);
    used += rendered.length + 1;
  }
  return out.join('\n');
}

function clamp(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n… (truncated)`;
}

/**
 * Assemble the single user message: repo skeleton, config files, then the
 * sampled sources — all inside one `<untrusted>` block, because repository
 * content is data to analyse and never an instruction to follow.
 */
export function buildSamplePayload({ files, configs, repoMap }: SamplePayloadInput): string {
  const parts: string[] = [];

  if (repoMap.trim()) {
    parts.push(`## REPO SKELETON\n\n${clamp(repoMap, MAX_REPO_MAP_CHARS)}`);
  }

  if (configs.length > 0) {
    const rendered = configs.map(
      (c) => `### ${c.path}\n\n${withLineNumbers(c.text, MAX_CONFIG_FILE_CHARS)}`,
    );
    parts.push(`## CONFIG FILES\n\n${rendered.join('\n\n')}`);
  }

  let budget = MAX_PAYLOAD_CHARS - parts.join('\n\n').length;
  const blocks: string[] = [];
  for (const f of files) {
    if (budget <= 0) break;
    const block = `### ${f.path}\n\n${withLineNumbers(f.text, Math.min(MAX_FILE_CHARS, budget))}`;
    blocks.push(block);
    budget -= block.length;
  }
  parts.push(`## SAMPLED FILES\n\n${blocks.join('\n\n')}`);

  return `<untrusted>\n${parts.join('\n\n')}\n</untrusted>`;
}

// ---------------------------------------------------------------------------
// Evidence verification — the gate
// ---------------------------------------------------------------------------

export type EvidenceMatch =
  | { ok: true; startLine: number; endLine: number }
  | { ok: false; reason: 'snippet_not_found' };

/** Trailing space trimmed, internal runs collapsed, indentation normalised. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

interface NormalizedLine {
  /** Real 1-based line number in the ORIGINAL text. */
  line: number;
  text: string;
}

/** Non-blank lines only, each normalised but remembering its true line number. */
function normalizedLines(text: string): NormalizedLine[] {
  const out: NormalizedLine[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = normalizeLine(lines[i] ?? '');
    if (normalized) out.push({ line: i + 1, text: normalized });
  }
  return out;
}

/**
 * Is `snippet` really in `fileText`, and if so WHERE?
 *
 * The model's `start_line` is never believed: this returns the line numbers of
 * the match it actually found. Comparison ignores blank lines and is
 * whitespace-insensitive (indentation, trailing space, collapsed runs), because
 * a model re-indenting a quote is a formatting artefact — but the token
 * sequence itself must be present, in order, contiguously.
 */
export function verifyEvidence(snippet: string, fileText: string): EvidenceMatch {
  const needle = normalizedLines(snippet);
  const haystack = normalizedLines(fileText);
  if (needle.length === 0 || haystack.length < needle.length) {
    return { ok: false, reason: 'snippet_not_found' };
  }

  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (haystack[start + k]!.text !== needle[k]!.text) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    return {
      ok: true,
      startLine: haystack[start]!.line,
      endLine: haystack[start + needle.length - 1]!.line,
    };
  }
  return { ok: false, reason: 'snippet_not_found' };
}

/**
 * `count` lines of `text` starting at 1-based `startLine`.
 *
 * This is how a displayed snippet is produced: the model supplies an anchor
 * line, `verifyEvidence` proves where that line really is, and the snippet is
 * cut from the file around it. So the code shown in the UI comes from disk and
 * cannot be something the model invented.
 *
 * Runs short at EOF rather than padding, and returns '' for a start past the
 * end — a caller asking for line 900 of a 40-line file gets nothing, not blanks.
 */
export function sliceLines(text: string, startLine: number, count: number): string {
  if (startLine < 1 || count < 1) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(startLine - 1, startLine - 1 + count).join('\n');
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/** Map a persisted convention row to the public `ConventionCandidate` DTO. */
export function toDto(row: ConventionRow): ConventionCandidate {
  const path = row.evidencePath ?? '';
  return {
    id: row.id,
    rule: row.rule,
    category: row.category,
    evidence_path: path,
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_start_line: row.evidenceStartLine ?? 1,
    evidence_end_line: row.evidenceEndLine ?? 1,
    evidence_files: row.evidenceFiles ?? (path ? [path] : []),
    occurrences: row.occurrences,
    confidence: row.confidence ?? 0,
    status: row.status,
    skill_id: row.skillId,
  };
}

// ---------------------------------------------------------------------------
// Skill draft
// ---------------------------------------------------------------------------

/**
 * Key used to recognise a rule the user has already triaged.
 *
 * At `temperature: 0` over an unchanged repo the model re-proposes the same
 * rules in near-identical wording, so lowercasing and flattening whitespace and
 * trailing punctuation is enough to match them.
 *
 * It will NOT catch a genuine rephrasing — "Use async/await" and "Prefer
 * async/await over .then()" are different keys and the second would resurface
 * as pending. Matching that would need embeddings; this is the cheap 90% and is
 * deliberately not presented as more.
 */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;:,!]+$/, '')
    .trim();
}

/** Lowercase, non-alphanumerics to single dashes, no leading/trailing dash. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Cap a rule slug so a 240-char rule doesn't become a 240-char heading. */
function headingSlug(rule: string): string {
  const slug = slugify(rule).slice(0, 60).replace(/-+$/, '');
  return slug || 'rule';
}

const FENCE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  go: 'go',
  rb: 'ruby',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  php: 'php',
  cs: 'csharp',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  sh: 'bash',
  md: 'md',
};

function fenceLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return FENCE_BY_EXTENSION[extension] ?? '';
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Merge the accepted candidates into ONE skill body.
 *
 * Filtering by `status` happens HERE rather than only at the call site on
 * purpose: a pending (untriaged) or explicitly rejected rule must never reach a
 * body a reviewer will act on, no matter which caller assembles the list.
 */
export function buildSkillDraft(repoName: string, accepted: ConventionCandidate[]): SkillDraft {
  const rules = accepted.filter((c) => c.status === 'accepted');
  const evidenceFiles = uniq(rules.flatMap((r) => r.evidence_files));
  const name = `${slugify(repoName) || 'repo'}-conventions`;

  const header = [
    `# ${name}`,
    '',
    `House conventions for \`${repoName}\`. Every rule below was verified against real code ` +
      `across ${evidenceFiles.length} files before it was included.`,
    'Flag changes that violate any rule below and cite the offending `file:line`.',
  ].join('\n');

  const sections = rules.map((r) => {
    const lines =
      r.evidence_start_line === r.evidence_end_line
        ? `${r.evidence_start_line}`
        : `${r.evidence_start_line}-${r.evidence_end_line}`;
    const plural = r.occurrences === 1 ? 'file' : 'files';
    return [
      `## ${headingSlug(r.rule)}`,
      '',
      r.rule,
      '',
      `Seen in ${r.occurrences} ${plural}, e.g. \`${r.evidence_path}:${lines}\`:`,
      '',
      `\`\`\`${fenceLanguage(r.evidence_path)}`,
      r.evidence_snippet,
      '```',
    ].join('\n');
  });

  return {
    name,
    description: `House conventions extracted from ${repoName}, each verified against real code.`,
    type: 'convention',
    body: [header, ...sections].join('\n\n'),
    evidence_files: evidenceFiles,
  };
}
