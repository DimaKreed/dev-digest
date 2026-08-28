/**
 * SPEC-01 AC-42 / AC-42.1 / AC-42.2 — attributing a walked file to a search root.
 *
 * Spec-first, derived from `specs/01-project-context-documents.md:211-239`.
 *
 * This is the seam AC-42's *name* matching actually lives on: discovery walks
 * the clone once from `.` (asserted in `adapters.test.ts`) and then classifies
 * each entry by directory NAME. Testing it directly puts the three rules in the
 * DB-free lane, where they run on a Docker-less runner — `context.it.test.ts`
 * covers the same rules end to end but self-skips without Docker.
 *
 * Pure function, so the fixtures are paths and nothing else.
 */
import { describe, it, expect } from 'vitest';
import type { RepoFileEntry } from '@devdigest/shared';
import { classifyByRoot } from '../src/modules/context/helpers.js';

/** The walk's output shape; only `path` matters to the classifier. */
function entry(path: string): RepoFileEntry {
  return { path, size: 100, updatedAt: '2026-08-27T10:00:00.000Z' };
}

const DEFAULT_ROOTS = new Set(['specs', 'docs', 'insights']);

function classify(paths: string[], roots: ReadonlySet<string> = DEFAULT_ROOTS) {
  return new Map(
    classifyByRoot(paths.map(entry), roots).map((d) => [d.entry.path, d.docType]),
  );
}

describe('SPEC-01 · classifying a walked file by search root', () => {
  it('AC-42 — a root matches its directory NAME at any depth, not only at the clone root', () => {
    const got = classify([
      'specs/top.md',
      'server/specs/README.md',
      'client/docs/adr/0007.md',
      'packages/x/specs/deep.md',
    ]);

    // The per-package documents the superseded top-level reading dropped.
    expect(got.has('server/specs/README.md')).toBe(true);
    expect(got.has('packages/x/specs/deep.md')).toBe(true);
    expect(got.has('client/docs/adr/0007.md')).toBe(true);
    // Non-vacuity: a top-level-only rule keeps exactly ONE of these four, so a
    // fixture without depth would pass against the old behaviour.
    expect(got.size).toBe(4);
    expect(got.has('specs/top.md')).toBe(true);
  });

  it('AC-42.1 — the displayed type is the matched directory\'s own name, never its path', () => {
    const got = classify(['server/specs/README.md', 'client/docs/adr/0007.md']);

    // `server/specs` and `client/docs` are what the row's `dir` carries; the
    // badge must be neither of them.
    expect(got.get('server/specs/README.md')).toBe('specs');
    expect(got.get('client/docs/adr/0007.md')).toBe('docs');
    for (const badge of got.values()) expect(badge).not.toContain('/');
  });

  it('AC-42.2 — a file beneath two matching directories belongs to the NEAREST one', () => {
    // The only fixture where nearest-ancestor and first-configured-root
    // disagree: `docs` is listed first, so a first-root rule would answer
    // `docs` for a file that sits inside `docs/specs/`.
    const got = classify(['docs/specs/x.md', 'docs/plain.md'], new Set(['docs', 'specs']));

    expect(got.get('docs/specs/x.md')).toBe('specs');
    expect(got.get('docs/plain.md')).toBe('docs');

    // Deeper still, and with the nesting reversed, so the answer cannot be an
    // artefact of which name happens to come first in the set.
    const deeper = classify(['a/specs/b/docs/c/x.md'], new Set(['specs', 'docs']));
    expect(deeper.get('a/specs/b/docs/c/x.md')).toBe('docs');
  });

  it('AC-42 — a file under no matching directory is not a context document', () => {
    const got = classify([
      'README.md',
      'server/src/index.md',
      'specification/notes.md',
      'my-docs/x.md',
    ]);

    // Nothing at the clone root, and nothing whose directory merely CONTAINS a
    // root name as a substring — `specification` is not `specs`, `my-docs` is
    // not `docs`. Matching a name must not decay into matching a prefix.
    expect([...got.keys()]).toEqual([]);
  });

  it('AC-42 — the walk order is preserved and each document is classified once', () => {
    const paths = ['docs/a.md', 'server/specs/b.md', 'specs/c.md'];
    const docs = classifyByRoot(paths.map(entry), DEFAULT_ROOTS);

    // One walk, one pass: a document reachable under a root appears exactly
    // once, and the caller's sorted order survives.
    expect(docs.map((d) => d.entry.path)).toEqual(paths);
    expect(new Set(docs.map((d) => d.entry.path)).size).toBe(docs.length);
  });

  it('AC-39 / AC-42 — an empty root set discovers nothing, rather than everything', () => {
    expect(classifyByRoot([entry('specs/x.md')], new Set())).toEqual([]);
  });
});
