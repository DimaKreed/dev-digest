/**
 * SPEC-01 — the trace/listing contract fields this feature adds (AC-31, AC-33,
 * AC-40, AC-24's recorded reason, AC-18's server-counted tokens).
 *
 * Spec-first. `run_traces.trace` is one jsonb document, so every field added
 * here must tolerate its own absence (AC-33 cites `insights.md:81` and the
 * `.nullish()` vs `.nullable()` rule) — a legacy trace document simply has no
 * such key. These assertions are written against the CANONICAL copy in
 * `server/src/vendor/shared/`; the client copy must be edited alongside it.
 *
 * Field names (`context_docs`, `context_skipped`, `specs_tokens`, and the
 * `SpecFile` additions) follow the development plan; the criteria are the
 * source of what must hold.
 */
import { describe, it, expect } from 'vitest';
import { PromptAssembly, RunTrace } from '../src/vendor/shared/contracts/trace.js';
import { SpecFile } from '../src/vendor/shared/contracts/platform.js';

/** A trace document as written before this feature existed. */
const LEGACY_TRACE = {
  config: { agent: 'Security', model: 'gpt-4.1', source: 'local' },
  stats: {
    duration_ms: 8200,
    tokens_in: 14820,
    tokens_out: 1240,
    findings: 3,
    grounding: '3/3 passed',
  },
  prompt_assembly: { system: 'You are a reviewer.', skills: null, user: '## Diff to review' },
  tool_calls: [],
  raw_output: '{}',
  memory_pulled: [],
  specs_read: [],
  log: [],
};

describe('SPEC-01 · trace contract', () => {
  it('AC-33 — a trace document written before this feature still parses', () => {
    const parsed = RunTrace.parse(LEGACY_TRACE);

    const extra = parsed as unknown as Record<string, unknown>;
    expect(extra.context_docs).toBeUndefined();
    expect(extra.context_skipped).toBeUndefined();
    expect(parsed.prompt_assembly.system).toBe('You are a reviewer.');
  });

  it('AC-33 — PromptAssembly tolerates the absence of the project-context token count', () => {
    const assembly = PromptAssembly.parse({
      system: 'You are a reviewer.',
      skills: null,
      user: '## Diff to review',
    });

    expect((assembly as unknown as Record<string, unknown>).specs_tokens).toBeUndefined();
  });

  it('AC-31 / AC-24 — a fresh trace carries every document read with its token size, and every skip with its reason', () => {
    const fresh = RunTrace.parse({
      ...LEGACY_TRACE,
      specs_read: ['specs/public-api.md'],
      prompt_assembly: {
        ...LEGACY_TRACE.prompt_assembly,
        specs: '<untrusted source="spec-0">\n# Public API\n</untrusted>',
        specs_tokens: 42,
      },
      context_docs: [{ path: 'specs/public-api.md', tokens: 42 }],
      context_skipped: [{ path: 'docs/gone.md', reason: 'missing' }],
    });

    const doc = (fresh as unknown as { context_docs: { path: string; tokens: number }[] })
      .context_docs[0]!;
    expect(doc.path).toBe('specs/public-api.md');
    expect(doc.tokens).toBe(42);

    const skipped = (
      fresh as unknown as { context_skipped: { path: string; reason: string }[] }
    ).context_skipped[0]!;
    expect(skipped.path).toBe('docs/gone.md');
    expect(skipped.reason).toBe('missing');

    // AC-32: the full injected text is what the `Prompt assembly` block opens.
    expect(fresh.prompt_assembly.specs).toContain('# Public API');
    expect(fresh.specs_read).toEqual(['specs/public-api.md']);
  });

  it('AC-24 — the skip reason is a fixed set: missing, unreadable, or escaping the clone', () => {
    for (const reason of ['missing', 'unreadable', 'escapes']) {
      expect(() =>
        RunTrace.parse({ ...LEGACY_TRACE, context_skipped: [{ path: 'a.md', reason }] }),
      ).not.toThrow();
    }
    expect(() =>
      RunTrace.parse({ ...LEGACY_TRACE, context_skipped: [{ path: 'a.md', reason: 'whatever' }] }),
    ).toThrow();
  });
});

describe('SPEC-01 · document listing contract', () => {
  it('AC-03 / AC-02 / AC-09 / AC-18 — a listed document carries its directory, type, server-counted tokens and attach count', () => {
    const row = SpecFile.parse({
      path: 'specs/public-api.md',
      dir: 'specs',
      doc_type: 'specs',
      size: 1200,
      tokens: 300,
      used_by: 2,
      updated_at: '2026-08-27T10:00:00.000Z',
    }) as unknown as Record<string, unknown>;

    expect(row.dir).toBe('specs');
    expect(row.doc_type).toBe('specs');
    expect(row.tokens).toBe(300);
    expect(row.used_by).toBe(2);
  });

  it('AC-40 — an oversized document is still listable, marked not-attachable with its reason', () => {
    const row = SpecFile.parse({
      path: 'docs/huge.md',
      dir: 'docs',
      doc_type: 'docs',
      attachable: false,
      not_attachable_reason: 'too_large',
    }) as unknown as Record<string, unknown>;

    expect(row.attachable).toBe(false);
    expect(row.not_attachable_reason).toBeTruthy();
  });

  it('AC-33 — a SpecFile written before this feature (path only) still parses', () => {
    expect(() => SpecFile.parse({ path: 'specs/old.md' })).not.toThrow();
  });
});
