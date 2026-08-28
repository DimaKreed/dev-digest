/**
 * SPEC-01 — configured search roots (AC-39, AC-02, AC-29).
 *
 * Spec-first: the criteria come from `specs/01-project-context-documents.md`,
 * not from `platform/config.ts`. AC-39 is the stage-5 gate resolution — named
 * directory prefixes, default `specs` / `docs` / `insights`, NO clone-root
 * entry — and the displayed document type is the label of the matched root
 * (AC-02), so the label must live on the root itself.
 *
 * `loadConfig` takes an explicit env, so nothing here reads the real process
 * environment. Config key name (`DEVDIGEST_CONTEXT_ROOTS`) and the field name
 * (`contextRoots`) follow the development plan; the criteria are AC-39/AC-02.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

type Root = { dir: string };

function rootsOf(env: Record<string, string> = {}): Root[] {
  const config = loadConfig({ NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);
  return (config as unknown as { contextRoots?: readonly Root[] }).contextRoots as Root[];
}

describe('SPEC-01 · context search roots', () => {
  it('AC-39 / AC-42 — defaults to the three named roots, and a root is a NAME and nothing else', () => {
    const roots = rootsOf();

    expect(roots).toBeDefined();
    expect(roots.map((r) => r.dir)).toEqual(['specs', 'docs', 'insights']);
    // A root carries `dir` alone. `recursive` used to live here and is gone
    // under AC-42: recursion is no longer a property OF a root, because
    // discovery makes one whole-clone traversal and attributes files to root
    // NAMES afterwards. A per-root flag would now be a setting nothing reads.
    for (const r of roots) expect(Object.keys(r)).toEqual(['dir']);
  });

  it('AC-39 / AC-42 — the clone root is NOT a search root, and every root is a bare NAME: no glob, no path', () => {
    const roots = rootsOf();

    // The `.` entry was dropped at the stage-5 gate.
    expect(roots.map((r) => r.dir)).not.toContain('.');
    expect(roots.map((r) => r.dir)).not.toContain('');
    // Not a glob — AC-39 kept named roots rather than `**/{specs,docs}/**`.
    for (const r of roots) expect(r.dir).not.toMatch(/[*?{}]/);
    // AC-42: and not a PATH either. A root is one directory name, matched at
    // any depth, so a separator in a configured root would mean the top-level
    // reading has crept back in as a workaround (`server/specs`).
    for (const r of roots) expect(r.dir).not.toMatch(/[\\/]/);
  });

  it('AC-42 — a configured root stays a bare name after normalisation', () => {
    // `./docs/` and `docs` are the same root: the parser strips the decoration
    // rather than producing a path that would only match at the clone root.
    const roots = rootsOf({ DEVDIGEST_CONTEXT_ROOTS: './docs/,specs' });

    expect(roots.map((r) => r.dir)).toEqual(['docs', 'specs']);
    for (const r of roots) expect(r.dir).not.toMatch(/[\\/]/);
  });

  it('AC-41 / AC-02 — a root carries no separate label: the directory name IS the displayed type', () => {
    const roots = rootsOf();

    // AC-41 supersedes the closed `spec | doc | insight` vocabulary. There is
    // nothing left to map, so a `label` field would be a second source of truth
    // for the badge — its absence is the assertion.
    for (const r of roots) expect('label' in r).toBe(false);
    // …and the type a document displays is therefore the plural directory name,
    // which is also what the supplied design shows.
    expect(roots.map((r) => r.dir)).toEqual(['specs', 'docs', 'insights']);
  });

  it('AC-41 — an arbitrary configured root is its own type, so two roots never display alike', () => {
    const roots = rootsOf({ DEVDIGEST_CONTEXT_ROOTS: 'adr,rfc' });

    expect(roots.map((r) => r.dir)).toEqual(['adr', 'rfc']);
    // The regression AC-41 exists to prevent: `adr` and `rfc` collapsing onto
    // one fallback value. Distinctness is the criterion, stated as such.
    expect(new Set(roots.map((r) => r.dir)).size).toBe(roots.length);
  });

  it('AC-39 — a configured list replaces the default, one root per named prefix', () => {
    const roots = rootsOf({ DEVDIGEST_CONTEXT_ROOTS: 'a,b' });

    expect(roots.map((r) => r.dir)).toEqual(['a', 'b']);
    for (const r of roots) expect(r.dir.length).toBeGreaterThan(0);
  });

  it('AC-29 — the indexer flags do not change discovery configuration', () => {
    const on = rootsOf({ EMBEDDINGS_ENABLED: 'true', REPO_INTEL_ENABLED: 'true' });
    const off = rootsOf({ EMBEDDINGS_ENABLED: 'false', REPO_INTEL_ENABLED: 'false' });

    expect(off).toEqual(on);
  });
});
