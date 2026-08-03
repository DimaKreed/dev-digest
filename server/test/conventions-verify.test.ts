import { describe, it, expect } from 'vitest';
import type { ConventionCandidate } from '@devdigest/shared';
import {
  buildSamplePayload,
  buildSkillDraft,
  slugify,
  verifyEvidence,
} from '../src/modules/conventions/helpers.js';

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
