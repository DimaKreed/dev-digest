import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { DROP_ORDER, FILE_LIST_HEAD_N } from '../src/modules/brief/constants.js';
import {
  fitToBudget,
  groundingFrom,
  summariseBlast,
  verifyRefs,
} from '../src/modules/brief/helpers.js';
import {
  PrBriefGeneration,
  type BriefBlastRead,
  type BriefFacts,
  type BriefIndexStateRead,
} from '../src/modules/brief/ports.js';

/**
 * SPEC-03 (PR Brief) — the DB-FREE half.
 *
 * Written spec-first: every assertion below is derived from an `AC-NN` in
 * `specs/03-pr-brief-card.md`, not from an implementation. It is expected to be
 * RED until the brief module ships.
 *
 * Only AC-23 lives here. AC-23 requires the rejection to happen *before the
 * handler runs*, which is exactly what makes it observable with no database:
 * `schema: { params: IdParams }` lets the zod type provider answer 422 while
 * postgres-js is still lazily unconnected — the same reasoning that puts the
 * SPEC-01 body-validation case in `routes-smoke.test.ts`. Every other server
 * criterion needs a real pull request row and therefore lives in
 * `brief.it.test.ts`.
 *
 * Route paths follow `.devdigest/cache/plans/pr-brief.md` W6 —
 * `GET /pulls/:id/brief` (read) and `POST /pulls/:id/brief/generate`
 * (generate). Both are asserted, so a single-route implementation still has one
 * of the two proved.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('PR brief routes (no DB)', () => {
  it('AC-23 — a malformed pull request identifier is rejected with 422 before any handler or DB', async () => {
    const app = await buildApp({ config });

    // The identifier is the `pull_requests.id` uuid — never the GitHub PR
    // number, which is what makes a bare integer malformed here too.
    for (const badId of ['not-a-uuid', '482', '11111111-1111-4111-8111']) {
      const read = await app.inject({ method: 'GET', url: `/pulls/${badId}/brief` });
      expect(read.statusCode).toBe(422);
      expect(read.json().error.code).toBe('validation_error');

      const generate = await app.inject({
        method: 'POST',
        url: `/pulls/${badId}/brief/generate`,
        payload: {},
      });
      expect(generate.statusCode).toBe(422);
      expect(generate.json().error.code).toBe('validation_error');
    }

    await app.close();
  });
});

/**
 * The pure kernel, driven directly.
 *
 * `container.reviewRepo` is not a `ContainerOverrides` key, so a generation
 * cannot be driven end to end hermetically and every criterion about it lives
 * in `brief.it.test.ts`. `fitToBudget`, `verifyRefs` and `summariseBlast` need
 * no container at all — they are ring-0 total functions of their arguments —
 * so the budget logic and the grounding logic get executing assertions on a
 * Docker-less runner here, rather than only on a runner that has Postgres.
 *
 * The counter injected below is `text.length`, not the real tokenizer: AC-04 is
 * enforced against whatever counter it is handed (the encoder or its permanent
 * character-estimate fallback), and a test that assumed real token counts would
 * assert the encoder rather than the budget.
 */
const len = (text: string) => text.length;

function facts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    repoFullName: 'acme/payments-api',
    prNumber: 482,
    title: 'Add a per-route rate limit to the review endpoints',
    description: 'D'.repeat(300),
    intent: {
      intent: 'Introduce per-route rate limiting',
      in_scope: ['src/pay.ts'],
      out_of_scope: ['the billing job'],
    },
    diffStats: { filesChanged: 40, additions: 412, deletions: 77 },
    changedFiles: Array.from({ length: 40 }, (_, i) => `src/generated/file-${i}.ts`),
    blastSummary: 'B'.repeat(400),
    issues: [{ ref: '#12', title: 'Rate limit the API', body: 'I'.repeat(600) }],
    contextDocs: [{ path: 'docs/architecture.md', text: 'C'.repeat(900) }],
    ...over,
  };
}

describe('brief helpers — the token budget (no DB, no container)', () => {
  it('AC-04 / AC-05 / AC-06 — drops in the fixed order, records the names, and never drops the intent or the diff stats', () => {
    // An unreachable cap forces every applicable step, which is what makes the
    // ORDER observable rather than just the outcome.
    const fitted = fitToBudget(facts(), len, 0);

    expect(fitted.dropped).toEqual([...DROP_ORDER]);
    expect(fitted.dropped).toEqual([
      'project_context',
      'issue_body',
      'file_list_tail',
      'blast_downstream',
    ]);

    // AC-05 — the two inputs that are never dropped are still in the payload,
    // after every droppable one has gone.
    expect(fitted.payload).toContain('Derived intent');
    expect(fitted.payload).toContain('Introduce per-route rate limiting');
    expect(fitted.payload).toContain('Diff stats');
    expect(fitted.payload).toContain('412');

    // ...and each drop actually happened, rather than merely being reported.
    expect(fitted.facts.contextDocs).toEqual([]);
    expect(fitted.facts.issues.every((i) => i.body === '')).toBe(true);
    expect(fitted.facts.changedFiles).toHaveLength(FILE_LIST_HEAD_N);
    expect(fitted.facts.blastSummary).toBe('');
    expect(fitted.payload).not.toContain('docs/architecture.md');

    // AC-03 — no hunk body reaches the model. `BriefFacts` carries no patch
    // field at all, so this is structural; the assertion guards the day one is
    // added to the fact set "just for context".
    expect(fitted.payload).not.toContain('@@');
  });

  it('AC-04 — stops the moment the payload fits, and a payload that already fits drops nothing', () => {
    // The cap is DERIVED, not guessed: it is exactly the size of the payload
    // after the first drop, so a second drop would be the implementation
    // over-shooting rather than the fixture being lucky.
    const afterFirstDrop = fitToBudget(facts({ contextDocs: [] }), len, Number.MAX_SAFE_INTEGER);
    expect(afterFirstDrop.dropped).toEqual([]);

    const cap = len(afterFirstDrop.payload);
    const fitted = fitToBudget(facts(), len, cap);

    expect(fitted.dropped).toEqual(['project_context']);
    expect(len(fitted.payload)).toBeLessThanOrEqual(cap);
    // The issue body survived, so the drop order really did stop at step one.
    expect(fitted.payload).toContain('I'.repeat(600));
  });

  it('AC-06 — a step that would change nothing is not reported as a dropped input', () => {
    // Reporting "the project context was dropped" for a PR that has none is a
    // claim the reader cannot check, and AC-06 is a honesty criterion.
    const fitted = fitToBudget(
      facts({ contextDocs: [], issues: [], changedFiles: ['src/pay.ts'], blastSummary: '' }),
      len,
      0,
    );

    expect(fitted.dropped).toEqual([]);
  });
});

describe('brief helpers — grounding (no DB, no container)', () => {
  const output = (over: Partial<PrBriefGeneration> = {}) =>
    // Validated through the REAL schema: a fixture the model contract would
    // reject is a broken fake, not a passing test.
    PrBriefGeneration.parse({
      risk_level: 'high',
      what: 'Adds a per-route rate limit.',
      why: 'It fronts every paid route.',
      risks: [],
      review_focus: [],
      ...over,
    });

  const grounding = groundingFrom(
    facts({
      changedFiles: ['src/pay.ts', 'src/config.ts'],
      contextDocs: [{ path: 'docs/architecture.md', text: 'C' }],
    }),
  );

  it('AC-13 — an entry naming a path that was not in the assembled input is dropped and counted', () => {
    const verified = verifyRefs(
      output({
        risks: [
          {
            title: 'grounded',
            explanation: 'names a changed file',
            severity: 'high',
            refs: [{ path: 'src/pay.ts', line: 12 }],
          },
          {
            title: 'invented',
            explanation: 'names a file the model was never shown',
            severity: 'medium',
            refs: [{ path: 'src/does-not-exist.ts', line: 3 }],
          },
          {
            title: 'half invented',
            explanation: 'one good ref and one invented one',
            severity: 'low',
            refs: [{ path: 'src/pay.ts' }, { path: 'src/nope.ts' }],
          },
        ],
        review_focus: [
          { label: 'kept', ref: { path: 'src/config.ts' }, reason: 'a changed file' },
          { label: 'kept too', ref: { path: 'docs/architecture.md' }, reason: 'an attached doc' },
          { label: 'dropped', ref: { path: 'src/imaginary.ts', line: 9 }, reason: 'invented' },
        ],
      }),
      grounding,
    );

    expect(verified.risks.map((r) => r.title)).toEqual(['grounded']);
    expect(verified.review_focus.map((f) => f.label)).toEqual(['kept', 'kept too']);
    // Two risks plus one focus entry — the count the card shows the reader.
    expect(verified.dropped).toBe(3);
  });

  it('AC-13 — a risk with no reference at all is kept: there is nothing to falsify', () => {
    const verified = verifyRefs(
      output({
        risks: [
          { title: 'prose only', explanation: 'no file named', severity: 'medium', refs: [] },
        ],
      }),
      grounding,
    );

    expect(verified.risks).toHaveLength(1);
    expect(verified.dropped).toBe(0);
  });

  it('AC-13 — a document dropped to fit the budget does not ground a reference to itself', () => {
    // The grounding set is built from the POST-drop fact set. Anything else
    // would let the model cite a document the call never contained.
    const dropped = groundingFrom(fitToBudget(facts(), len, 0).facts);

    expect(dropped.paths.has('docs/architecture.md')).toBe(false);
    expect(dropped.paths.has('src/generated/file-0.ts')).toBe(true);
    expect(dropped.paths.has(`src/generated/file-${FILE_LIST_HEAD_N}.ts`)).toBe(false);
  });
});

describe('brief helpers — the blast paragraph (no DB, no container)', () => {
  const blast = (over: Partial<BriefBlastRead> = {}): BriefBlastRead => ({
    changedSymbols: [{ name: 'registerRateLimit', file: 'src/pay.ts', kind: 'function' }],
    callers: [{ file: 'src/app.ts', symbol: 'buildApp', viaSymbol: 'registerRateLimit', line: 41 }],
    impactedEndpoints: ['POST /pulls/:id/review'],
    ...over,
  });
  const index = (over: Partial<BriefIndexStateRead> = {}): BriefIndexStateRead => ({
    status: 'full',
    filesIndexed: 548,
    edgesWritten: 1130,
    ...over,
  });

  it('AC-02 — a healthy read becomes one paragraph naming the symbols, the call sites and the endpoints', () => {
    const summary = summariseBlast(blast(), index());

    expect(summary).toContain('registerRateLimit');
    expect(summary).toContain('src/pay.ts');
    expect(summary).toContain('1 call site(s) across 1 file(s)');
    expect(summary).toContain('POST /pulls/:id/review');
  });

  it('AC-07 / AC-08 — a degraded or graph-less read yields no paragraph, never a confident "nothing is affected"', () => {
    // The empty string is the signal the service turns into a recorded degraded
    // source. A missing graph and an unaffected change arrive looking identical,
    // so neither may be rendered as a measurement.
    expect(summariseBlast(blast({ degraded: true, reason: 'index_missing' }), index())).toBe('');

    // `status: 'full'` means "nothing threw", not "the data is there" — the edge
    // builder degrades to an empty graph without throwing, so the counter is
    // what this branches on (server/insights.md).
    expect(summariseBlast(blast(), index({ edgesWritten: 0 }))).toBe('');

    // Zero files indexed is an empty repository, not a broken index — but there
    // is still nothing to say when the change reaches nothing.
    expect(
      summariseBlast(blast({ changedSymbols: [], callers: [] }), index({ filesIndexed: 0 })),
    ).toBe('');
  });
});
