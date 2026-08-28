/**
 * SPEC-01 — Project context documents, the ring-0 half.
 *
 * Spec-first: every assertion below is derived from an acceptance criterion in
 * `specs/01-project-context-documents.md`, not from the current implementation.
 * The `## Project context` seam already exists (`src/prompt.ts`), so some of
 * these pass today; AC-38 does not, and it is meant to fail until the guard is
 * amended.
 *
 * Criteria asserted here: AC-22, AC-23, AC-25, AC-28, AC-30, AC-38.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemblePrompt } from '../src/prompt.js';

/** The shape a run assembles once documents are resolved to strings (AC-28). */
const BASE = {
  system: 'You are a reviewer.',
  skills: ['## skill\nDetect X'],
  memory: ['Do not flag try/catch around JSON.parse'],
  diff: '@@ -1 +1 @@\n+stripeKey',
  task: "Review PR #482 'rate limit'",
} as const;

const DOC_A = '# Public API invariants\nEvery exported route is versioned.';
const DOC_B = '# Insights\nNever de-duplicate model output by its text.';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('SPEC-01 · injection into the `## Project context` section', () => {
  it('AC-22 — renders one untrusted delimiter-wrapped block per document, inside `## Project context`', () => {
    const user = userOf({ ...BASE, specs: [DOC_A, DOC_B] });

    expect(user).toContain('## Project context');
    // Each document in its OWN block — two openers, two closers, both bodies.
    const openers = user.match(/<untrusted source="spec-\d+">/g) ?? [];
    expect(openers).toHaveLength(2);
    expect(user).toContain('Every exported route is versioned.');
    expect(user).toContain('Never de-duplicate model output by its text.');
    // Persisted order is injection order.
    expect(user.indexOf(DOC_A)).toBeLessThan(user.indexOf(DOC_B));
  });

  it('AC-30 — no document path reaches the section header or an untrusted source label', () => {
    // A document whose own text names paths: only the WRAPPED content may carry
    // them, never the header or the `source="…"` label.
    const withPaths = '# Rules\nSee `specs/public-api.md` and `docs/adr/0007-"quote".md`.';
    const user = userOf({ ...BASE, specs: [withPaths] });

    const labels = [...user.matchAll(/<untrusted source="([^"]*)">/g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^[a-z-]+(-\d+)?$/);
    expect(user).not.toContain('source="specs/public-api.md"');
    // The header is a fixed literal, not a path-bearing string.
    const headers = user.match(/^## Project context.*$/gm) ?? [];
    expect(headers).toEqual(['## Project context']);
  });

  it('AC-23 — an empty document set omits the section, byte-identically to no attachments at all', () => {
    const baseline = userOf({ ...BASE });
    expect(userOf({ ...BASE, specs: [] })).toBe(baseline);
    expect(userOf({ ...BASE, specs: undefined })).toBe(baseline);
    expect(baseline).not.toContain('## Project context');
    // The trace slot must agree with the rendered prompt, or a trace claims an
    // injection the prompt never carried.
    expect(assemblePrompt({ ...BASE, specs: [] }).assembly.specs).toBeNull();
  });

  it('AC-25 — a document is injected verbatim, with no size cap and no truncation', () => {
    const huge = `# Huge\n${'a'.repeat(500_000)}\nEND-OF-DOCUMENT`;
    const user = userOf({ ...BASE, specs: [huge] });

    expect(user).toContain('END-OF-DOCUMENT');
    expect(user).toContain('a'.repeat(500_000));
  });

  it('AC-38 — the injection guard enumerates attached project documents, by wording alone', () => {
    const sys = systemOf({ ...BASE, specs: [DOC_A] });

    // The enumeration itself is now pinned: documents are named among the
    // untrusted sources.
    expect(sys).toMatch(/attached project documents/i);
    // …and the pre-existing guard baselines still hold (AC-38 requires them
    // updated, not weakened).
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
  });

  it('AC-28 — the engine takes resolved strings only: no filesystem in the prompt/run path', () => {
    // Documents are read outside the engine (server adapter). Ring 0 may not
    // touch a filesystem, so neither file may import one.
    for (const file of ['../src/prompt.ts', '../src/review/run.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from ['"]node:fs/);
      expect(src).not.toMatch(/require\(['"]fs['"]\)/);
      expect(src).not.toMatch(/readFileSync|readFile\(/);
    }
    // And the seam accepts plain strings — nothing port-shaped.
    const { assembly } = assemblePrompt({ ...BASE, specs: [DOC_A] });
    expect(typeof assembly.specs).toBe('string');
  });
});
