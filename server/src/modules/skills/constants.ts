/**
 * Skills module constants. Pure values only — no I/O, no imports from db/ or
 * adapters/ (arch rule `c5-pure-helpers` covers this file too).
 */

/** Version assigned to a skill on creation. */
export const INITIAL_SKILL_VERSION = 1;

/** Type assigned to an imported skill when its frontmatter doesn't declare one. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Trailing window for the run-derived tiles on the Stats tab. */
export const STATS_WINDOW_DAYS = 30;

// ---- Archive import limits ------------------------------------------------
// A skill import is untrusted input. These caps make a malicious archive a 4xx
// instead of an OOM; they are deliberately small because a skill is one .md.

/** Reject an archive with more entries than this (zip-bomb guard). */
export const MAX_ARCHIVE_ENTRIES = 200;

/** Reject an archive whose declared uncompressed size exceeds this. */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;

/** Upload size ceiling enforced by @fastify/multipart. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Cap on a description derived from the body's first paragraph. */
export const MAX_DERIVED_DESCRIPTION_CHARS = 300;

/**
 * Extensions we refuse to read. Matching entries are never decompressed — the
 * filter passed to `unzipSync` returns false before their bytes are touched —
 * and are surfaced in the preview as skipped so the user sees what was ignored.
 */
export const EXECUTABLE_EXTENSIONS = [
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.py',
  '.rb',
  '.pl',
  '.php',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.jar',
  '.bin',
];

/** The only extensions whose contents are read. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/** Preferred archive entry, matched on basename, case-insensitively. */
export const PREFERRED_ENTRY_BASENAME = 'skill.md';

// ---- URL import -----------------------------------------------------------

/** Response ceiling for a fetched skill. Matches the archive cap's intent. */
export const MAX_FETCHED_BYTES = 256 * 1024;

/** Whole-request budget for a URL import, redirects included. */
export const URL_FETCH_TIMEOUT_MS = 10_000;

/** Filename used when the URL path has no usable last segment. */
export const FALLBACK_URL_FILENAME = 'skill.md';

// ---- Injection scan -------------------------------------------------------

/** System prompt for the classifier; loaded via platform/prompts.ts. */
export const SAFETY_PROMPT_FILE = 'skill-safety.system.md';

/** Names the json_schema / tool in the structured request. */
export const SAFETY_SCHEMA_NAME = 'SkillSafetyVerdict';

/**
 * Providers tried in order. First one with a configured key classifies; none
 * configured ⇒ the scan returns null and the UI says so.
 *
 * `openrouter` is last but load-bearing: `.env.example` ships `OPENAI_API_KEY`
 * and `ANTHROPIC_API_KEY` empty, so on a box where only `OPENROUTER_API_KEY` is
 * set — the common case here, since it is what every seeded agent uses — the
 * first two entries both raise `ConfigError` and the scan would degrade to
 * "could not be scanned" despite a usable model being available. Appending
 * rather than prepending keeps the cheaper OpenAI classifier preferred wherever
 * that key does exist.
 */
export const SAFETY_PROVIDER_ORDER = ['openai', 'anthropic', 'openrouter'] as const;

/** Body prefix sent to the classifier. An injection buried past this is itself a signal. */
export const SAFETY_MAX_BODY_CHARS = 24_000;

/** The verdict is a summary plus a few short quotes — it needs no more room. */
export const SAFETY_MAX_TOKENS = 1200;

/** The scan runs inline on a preview request; a slow provider must not hang it. */
export const SAFETY_TIMEOUT_MS = 30_000;
