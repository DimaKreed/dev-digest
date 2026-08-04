import { describe, it, expect } from 'vitest';
import type { ConventionCandidate } from '@devdigest/shared';
import {
  buildSamplePayload,
  buildSkillDraft,
  normalizeRule,
  sliceLines,
  slugify,
  suppressionKeys,
  verifyEvidence,
} from '../src/modules/conventions/helpers.js';
import type { SuppressionInput } from '../src/modules/conventions/ports.js';

/**
 * Hermetic unit tests for the conventions core — no DB, no Docker, no model.
 *
 * `verifyEvidence` is the gate the whole feature rests on: it is the reason a
 * candidate can be trusted at all, so it is tested against the ways a model
 * really mangles a quote (re-indentation, collapsed spacing, dropped blank
 * lines) as well as against outright invention.
 */

const FILE = [
  "import { getContext } from '../shared/context';", // 1
  '', // 2
  'export async function listUsers(req) {', // 3
  '  const { workspaceId } = await getContext(container, req);', // 4
  '  return repo.list(workspaceId);', // 5
  '}', // 6
].join('\n');

describe('verifyEvidence', () => {
  it('matches a snippet verbatim and reports its REAL 1-based lines', () => {
    const match = verifyEvidence('  return repo.list(workspaceId);', FILE);
    expect(match).toEqual({ ok: true, startLine: 5, endLine: 5 });
  });

  it('ignores leading and trailing whitespace differences', () => {
    const match = verifyEvidence('   return repo.list(workspaceId);   \n', FILE);
    expect(match).toEqual({ ok: true, startLine: 5, endLine: 5 });
  });

  it('ignores indentation the model re-flowed', () => {
    // The model dropped the two-space indent entirely.
    const match = verifyEvidence('const { workspaceId } = await getContext(container, req);', FILE);
    expect(match).toEqual({ ok: true, startLine: 4, endLine: 4 });
  });

  it('collapses internal whitespace runs', () => {
    const match = verifyEvidence('const {  workspaceId }   =  await getContext(container, req);', FILE);
    expect(match).toEqual({ ok: true, startLine: 4, endLine: 4 });
  });

  it('matches a multi-line snippet and spans the real first/last lines', () => {
    const snippet = [
      'export async function listUsers(req) {',
      '  const { workspaceId } = await getContext(container, req);',
      '  return repo.list(workspaceId);',
    ].join('\n');
    expect(verifyEvidence(snippet, FILE)).toEqual({ ok: true, startLine: 3, endLine: 5 });
  });

  it('ignores blank lines on either side of the comparison', () => {
    // Snippet spans the file's blank line 2 but writes no blank line itself…
    const contiguous = ["import { getContext } from '../shared/context';", 'export async function listUsers(req) {'].join('\n');
    expect(verifyEvidence(contiguous, FILE)).toEqual({ ok: true, startLine: 1, endLine: 3 });

    // …and the reverse: extra blank lines inside the snippet are ignored too.
    const padded = ['', '  return repo.list(workspaceId);', '', '}', ''].join('\n');
    expect(verifyEvidence(padded, FILE)).toEqual({ ok: true, startLine: 5, endLine: 6 });
  });

  it('rejects a snippet that is not in the file', () => {
    const match = verifyEvidence('return repo.listOrders(workspaceId);', FILE);
    expect(match).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('rejects a snippet longer than the file', () => {
    const longer = [...FILE.split('\n'), 'extra();', 'more();'].join('\n');
    expect(verifyEvidence(longer, FILE)).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('rejects an empty or whitespace-only snippet', () => {
    expect(verifyEvidence('', FILE)).toEqual({ ok: false, reason: 'snippet_not_found' });
    expect(verifyEvidence('   \n\n  ', FILE)).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('requires the lines to be contiguous, not merely present', () => {
    const outOfOrder = ['  return repo.list(workspaceId);', 'export async function listUsers(req) {'].join('\n');
    expect(verifyEvidence(outOfOrder, FILE)).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('returns the FIRST occurrence when a pattern repeats', () => {
    const repeated = ['a();', 'log(x);', 'b();', 'log(x);'].join('\n');
    expect(verifyEvidence('log(x);', repeated)).toEqual({ ok: true, startLine: 2, endLine: 2 });
  });
});

// ---------------------------------------------------------------------------

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    rule: 'Route handlers resolve tenancy with getContext before any other call.',
    category: 'structure',
    evidence_path: 'src/api/users.ts',
    evidence_snippet: '  const { workspaceId } = await getContext(container, req);',
    evidence_start_line: 4,
    evidence_end_line: 4,
    evidence_files: ['src/api/users.ts', 'src/api/orders.ts'],
    occurrences: 2,
    confidence: 0.9,
    status: 'accepted',
    skill_id: null,
    ...over,
  };
}

describe('buildSkillDraft', () => {
  it('renders one merged skill named after the repo', () => {
    const draft = buildSkillDraft('payments-api', [candidate()]);
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('# payments-api-conventions');
    expect(draft.body).toContain('House conventions for `payments-api`');
    expect(draft.body).toContain('Route handlers resolve tenancy');
    // Primary evidence is cited as file:line and fenced with the file's language.
    expect(draft.body).toContain('Seen in 2 files, e.g. `src/api/users.ts:4`:');
    expect(draft.body).toContain('```ts');
    expect(draft.evidence_files).toEqual(['src/api/users.ts', 'src/api/orders.ts']);
  });

  it('EXCLUDES rejected and pending candidates from the merged body', () => {
    const draft = buildSkillDraft('payments-api', [
      candidate({ id: 'a', rule: 'Accepted rule about repository return values.', status: 'accepted' }),
      candidate({
        id: 'p',
        rule: 'Pending rule nobody has triaged yet.',
        status: 'pending',
        evidence_files: ['src/pending-only.ts', 'src/pending-two.ts'],
      }),
      candidate({
        id: 'r',
        rule: 'Rejected rule a human threw out.',
        status: 'rejected',
        evidence_files: ['src/rejected-only.ts', 'src/rejected-two.ts'],
      }),
    ]);

    expect(draft.body).toContain('Accepted rule about repository return values.');
    expect(draft.body).not.toContain('Pending rule nobody has triaged yet.');
    expect(draft.body).not.toContain('Rejected rule a human threw out.');
    // Their evidence must not leak into the skill's provenance either.
    expect(draft.evidence_files).toEqual(['src/api/users.ts', 'src/api/orders.ts']);
  });

  it('dedupes evidence_files across candidates', () => {
    const draft = buildSkillDraft('payments-api', [
      candidate({ id: 'a', rule: 'First rule with shared evidence files.' }),
      candidate({
        id: 'b',
        rule: 'Second rule with one overlapping evidence file.',
        evidence_files: ['src/api/orders.ts', 'src/api/carts.ts'],
      }),
    ]);
    expect(draft.evidence_files).toEqual([
      'src/api/users.ts',
      'src/api/orders.ts',
      'src/api/carts.ts',
    ]);
  });

  it('renders a header-only body when nothing is accepted', () => {
    const draft = buildSkillDraft('payments-api', [candidate({ status: 'pending' })]);
    expect(draft.evidence_files).toEqual([]);
    expect(draft.body).not.toContain('```');
  });

  it('renders a line RANGE when the primary evidence spans several lines', () => {
    const draft = buildSkillDraft('payments-api', [
      candidate({ evidence_start_line: 23, evidence_end_line: 31, occurrences: 3 }),
    ]);
    expect(draft.body).toContain('Seen in 3 files, e.g. `src/api/users.ts:23-31`:');
  });
});

describe('sliceLines', () => {
  const FILE = ['one', 'two', 'three', 'four'].join('\n');

  it('takes `count` lines from a 1-based start', () => {
    expect(sliceLines(FILE, 2, 2)).toBe('two\nthree');
  });

  it('runs short at EOF instead of padding', () => {
    expect(sliceLines(FILE, 4, 10)).toBe('four');
  });

  it('returns nothing for a start past the end', () => {
    // A model claiming line 900 of a 4-line file must yield an empty snippet,
    // never a run of blank lines that looks like real but empty code.
    expect(sliceLines(FILE, 900, 3)).toBe('');
  });

  it('rejects a non-positive start or count', () => {
    expect(sliceLines(FILE, 0, 2)).toBe('');
    expect(sliceLines(FILE, 1, 0)).toBe('');
  });

  it('normalises CRLF so line counts match verifyEvidence', () => {
    expect(sliceLines('a\r\nb\r\nc', 2, 2)).toBe('b\nc');
  });
});

describe('normalizeRule', () => {
  it('treats casing, spacing and trailing punctuation as the same rule', () => {
    const a = 'Route handlers   resolve tenancy with getContext.';
    const b = 'route handlers resolve tenancy with getContext';
    expect(normalizeRule(a)).toBe(normalizeRule(b));
  });

  it('keeps genuinely different rules apart', () => {
    expect(normalizeRule('Use async/await')).not.toBe(
      normalizeRule('Prefer async/await over .then() chains'),
    );
  });
});

describe('suppressionKeys', () => {
  const shareAKey = (a: SuppressionInput, b: SuppressionInput) =>
    suppressionKeys(a).some((k) => suppressionKeys(b).includes(k));

  it('matches a REWORDED rule that anchors on the same verified line', () => {
    // The live failure mode: text differs every scan, the anchor does not.
    const triaged = {
      rule: 'Import shared types using `import type` from `@devdigest/shared`.',
      evidencePath: 'client/src/app/agents/[id]/AgentEditor.tsx',
      evidenceStartLine: 9,
    };
    const reproposed = {
      rule: 'Import shared types with `import type` from the `@devdigest/shared` package.',
      evidencePath: 'client/src/app/agents/[id]/AgentEditor.tsx',
      evidenceStartLine: 9,
    };
    expect(normalizeRule(triaged.rule)).not.toBe(normalizeRule(reproposed.rule));
    expect(shareAKey(triaged, reproposed)).toBe(true);
  });

  it('does NOT merge two different rules that cite the same file at different lines', () => {
    // Both of these really were proposed against the same pair of files, so a
    // path-only or fileset-only key would collapse them and lose one.
    const importRule = {
      rule: 'Import shared types using `import type`.',
      evidencePath: 'client/src/app/agents/[id]/AgentEditor.tsx',
      evidenceStartLine: 9,
    };
    const i18nRule = {
      rule: 'UI text is retrieved through the `useTranslations` hook.',
      evidencePath: 'client/src/app/agents/[id]/AgentEditor.tsx',
      evidenceStartLine: 15,
    };
    expect(shareAKey(importRule, i18nRule)).toBe(false);
  });

  it('still matches on text alone when the row has no usable evidence', () => {
    const a = { rule: 'Handlers resolve tenancy first.', evidencePath: null, evidenceStartLine: null };
    const b = { rule: 'handlers   resolve tenancy first', evidencePath: null, evidenceStartLine: null };
    expect(suppressionKeys(a)).toHaveLength(1);
    expect(shareAKey(a, b)).toBe(true);
  });
});

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(slugify('Payments API')).toBe('payments-api');
    expect(slugify('  --Foo__Bar!! ')).toBe('foo-bar');
    expect(slugify('!!!')).toBe('');
  });
});

describe('buildSamplePayload', () => {
  it('numbers every line 1-based so the model can cite path:line', () => {
    const payload = buildSamplePayload({
      files: [{ path: 'src/api/users.ts', text: FILE }],
      configs: [{ path: 'tsconfig.json', text: '{\n  "strict": true\n}' }],
      repoMap: 'src/\n  api/',
    });
    expect(payload).toContain('<untrusted>');
    expect(payload).toContain('### src/api/users.ts');
    expect(payload).toContain("1 | import { getContext } from '../shared/context';");
    expect(payload).toContain('4 |   const { workspaceId } = await getContext(container, req);');
    expect(payload).toContain('### tsconfig.json');
    expect(payload).toContain('## REPO SKELETON');
  });

  it('omits the skeleton and config sections when there is nothing to show', () => {
    const payload = buildSamplePayload({
      files: [{ path: 'a.ts', text: 'x();' }],
      configs: [],
      repoMap: '',
    });
    expect(payload).not.toContain('## REPO SKELETON');
    expect(payload).not.toContain('## CONFIG FILES');
    expect(payload).toContain('## SAMPLED FILES');
  });
});
