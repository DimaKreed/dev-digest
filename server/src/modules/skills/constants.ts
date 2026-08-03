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
