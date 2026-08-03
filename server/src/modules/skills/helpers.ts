import { unzipSync } from 'fflate';
import type { Skill, SkillType, SkillSource, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow, SkipReason } from './ports.js';
import {
  DEFAULT_SKILL_TYPE,
  EXECUTABLE_EXTENSIONS,
  FALLBACK_URL_FILENAME,
  MARKDOWN_EXTENSIONS,
  MAX_ARCHIVE_ENTRIES,
  MAX_DERIVED_DESCRIPTION_CHARS,
  MAX_UNPACKED_BYTES,
  PREFERRED_ENTRY_BASENAME,
} from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping and archive
 * extraction. No I/O: nothing here touches the DB, the filesystem, or an
 * adapter (arch rule `c5-pure-helpers`). Token counting is NOT done here
 * because it needs `container.tokenizer`; the service adds it.
 */

/** Raised for input we refuse to process; the route maps it to 400. */
export class SkillImportError extends Error {}

/** What `extractSkill` yields — a `SkillImportPreview` minus `tokens`. */
export interface ExtractedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source_file: string;
  skipped: Array<{ path: string; reason: SkipReason }>;
}

// ---- DTO mapping ----------------------------------------------------------

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow, tokens: number, usedBy: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    tokens,
    used_by: usedBy,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    note: row.note,
    created_at: row.createdAt.toISOString(),
  };
}

// ---- Frontmatter / markdown parsing ---------------------------------------

const FRONTMATTER_DELIM = '---';

/**
 * Split leading YAML frontmatter off a markdown document.
 *
 * Deliberately NOT a YAML parser — a skill's frontmatter is flat `key: value`
 * lines, and pulling in a YAML dependency to read two keys out of untrusted
 * input would be all cost and no benefit. Anything it can't parse is ignored,
 * never thrown on.
 */
export function splitFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const normalized = text.replace(/^﻿/, '');
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIM) return { meta: {}, body: normalized };

  const closing = lines.findIndex((l, i) => i > 0 && l.trim() === FRONTMATTER_DELIM);
  if (closing === -1) return { meta: {}, body: normalized };

  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, closing)) {
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    // Strip one layer of matching quotes; leave everything else verbatim.
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (key) meta[key] = value;
  }
  return { meta, body: lines.slice(closing + 1).join('\n').replace(/^\n+/, '') };
}

/** First `# Heading` text, if the document opens with one. */
function headingName(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const m = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (m) return m[1];
    if (line.trim()) return undefined; // prose before any heading
  }
  return undefined;
}

/** First non-heading paragraph, collapsed and truncated. */
function derivedDescription(body: string): string {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text || text.startsWith('#')) continue;
    const collapsed = text.replace(/\s+/g, ' ');
    return collapsed.length > MAX_DERIVED_DESCRIPTION_CHARS
      ? `${collapsed.slice(0, MAX_DERIVED_DESCRIPTION_CHARS - 1).trimEnd()}…`
      : collapsed;
  }
  return '';
}

function isSkillType(v: string | undefined): v is SkillType {
  return v === 'rubric' || v === 'convention' || v === 'security' || v === 'custom';
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function extensionOf(path: string): string {
  const base = baseName(path).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function isMarkdown(path: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extensionOf(path));
}

function isExecutable(path: string): boolean {
  return EXECUTABLE_EXTENSIONS.includes(extensionOf(path));
}

/** Reject traversal / absolute entries before anything is decompressed. */
function assertSafeEntryPath(path: string): void {
  const normalized = path.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new SkillImportError(`Unsafe archive entry path: ${path}`);
  }
}

/** Fewest path segments wins; ties broken alphabetically for determinism. */
function shallowest(paths: string[]): string | undefined {
  return [...paths].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  })[0];
}

/**
 * Name the fetched document so `extractSkill` can parse it.
 *
 * A URL import is always markdown — the port hands back decoded TEXT, so a
 * `.zip` could not survive the trip and is deliberately not offered. Any other
 * extension is therefore replaced rather than trusted: `/docs/rules.html`
 * becomes `rules.md`, which is honest about what we actually parsed it as. The
 * basename only ever feeds the fallback skill name; frontmatter and the first
 * heading both win over it.
 */
export function fileNameFromUrl(rawUrl: string): string {
  let last = '';
  try {
    last = baseName(new URL(rawUrl).pathname.replace(/\/+$/, ''));
  } catch {
    last = '';
  }
  const decoded = (() => {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  if (!decoded) return FALLBACK_URL_FILENAME;
  if (isMarkdown(decoded)) return decoded;
  const stem = stripExtension(decoded);
  return stem ? `${stem}.md` : FALLBACK_URL_FILENAME;
}

// ---- Extraction -----------------------------------------------------------

function buildSkill(sourceFile: string, text: string, skipped: ExtractedSkill['skipped']) {
  const { meta, body } = splitFrontmatter(text);
  const trimmed = body.trim();
  if (!trimmed) throw new SkillImportError(`${sourceFile} has no content`);

  const declaredType = meta['type']?.toLowerCase();
  return {
    name: meta['name'] || headingName(trimmed) || stripExtension(baseName(sourceFile)),
    description: meta['description'] || derivedDescription(trimmed),
    type: isSkillType(declaredType) ? declaredType : DEFAULT_SKILL_TYPE,
    body: trimmed,
    source_file: sourceFile,
    skipped,
  } satisfies ExtractedSkill;
}

/**
 * Pull the skill core out of an uploaded `.md` or `.zip`.
 *
 * The security property this function exists to provide: **an executable entry
 * in the archive is never decompressed, never read, and never run.** That is
 * enforced by the `filter` passed to `unzipSync`, which decides per entry
 * BEFORE its bytes are inflated — not by inspecting output afterwards. Skipped
 * entries are reported so the UI can show exactly what was ignored.
 */
export function extractSkill(fileName: string, bytes: Uint8Array): ExtractedSkill {
  const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

  if (isMarkdown(fileName)) return buildSkill(baseName(fileName), decode(bytes), []);

  if (extensionOf(fileName) !== '.zip') {
    throw new SkillImportError('Unsupported file type — upload a .md or .zip');
  }

  // The filter runs once per entry and gates decompression. We use it to
  // enumerate the archive and to admit ONLY markdown.
  const seen: string[] = [];
  let declaredBytes = 0;
  const unpacked = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name.endsWith('/')) return false; // directory record
      assertSafeEntryPath(entry.name);
      seen.push(entry.name);
      if (seen.length > MAX_ARCHIVE_ENTRIES) {
        throw new SkillImportError(`Archive has more than ${MAX_ARCHIVE_ENTRIES} entries`);
      }
      declaredBytes += entry.originalSize;
      if (declaredBytes > MAX_UNPACKED_BYTES) {
        throw new SkillImportError('Archive is too large once unpacked');
      }
      return isMarkdown(entry.name);
    },
  });

  const markdownPaths = Object.keys(unpacked);
  if (markdownPaths.length === 0) {
    throw new SkillImportError('No .md file found in the archive');
  }

  const preferred = markdownPaths.find(
    (p) => baseName(p).toLowerCase() === PREFERRED_ENTRY_BASENAME,
  );
  const chosen = preferred ?? shallowest(markdownPaths)!;

  const skipped = seen
    .filter((p) => p !== chosen)
    .map((path) => ({
      path,
      reason: isExecutable(path)
        ? ('executable' as const)
        : isMarkdown(path)
          ? ('unused_markdown' as const)
          : ('not_markdown' as const),
    }));

  return buildSkill(chosen, decode(unpacked[chosen]!), skipped);
}
