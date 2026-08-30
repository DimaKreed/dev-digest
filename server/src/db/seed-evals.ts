/**
 * The starter eval set for the Security Reviewer (SPEC-04 AC-14).
 *
 * Ten cases, both polarities, each self-contained: a frozen unified diff plus
 * the `file:line` the agent must — or must not — report. Nothing here reads a
 * pull request, so the set is runnable on a fresh database with no clone, no
 * GitHub token and no indexer.
 *
 * WHY SEEDED AT ALL, when the product's own story is "your accept/dismiss
 * decisions are the dataset": a fresh checkout has no such decisions yet, and a
 * harness with an empty set cannot demonstrate that a prompt edit moved a
 * number. These ten are the floor. Cases built from real findings land beside
 * them and are indistinguishable once created.
 *
 * The line numbers are DERIVED from the hunk bodies below (`buildCase`), never
 * typed by hand: the citation-grounding gate drops a finding whose lines miss
 * the hunk, so an expectation typed one line off would make a case that no
 * correct agent can ever pass.
 */

export type SeedExpectationKind = 'must_find' | 'must_not_flag';

export interface SeedEvalCase {
  name: string;
  expectationKind: SeedExpectationKind;
  /** Path of the single changed file. */
  path: string;
  /** New-side start line of the hunk. */
  newStart: number;
  /** Hunk body: each line already carries its ' ', '+' or '-' prefix. */
  body: string[];
  /** Index into `body` of the line the expectation points at. */
  target: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: 'bug' | 'security' | 'perf' | 'style' | 'test';
  title: string;
  notes: string;
}

/** The materialised case: a unified diff plus the expectation's resolved lines. */
export interface BuiltEvalCase {
  name: string;
  expectationKind: SeedExpectationKind;
  inputDiff: string;
  notes: string;
  expectation: {
    file: string;
    start_line: number;
    end_line: number;
    severity: string;
    category: string;
    title: string;
  };
}

/**
 * Resolve a case's expectation line by replaying the parser's cursor rule: a
 * context or added line consumes a new-side line, a deletion does not.
 */
export function buildCase(c: SeedEvalCase): BuiltEvalCase {
  let cursor = c.newStart;
  let line = c.newStart;
  for (let i = 0; i < c.body.length; i++) {
    if (i === c.target) {
      line = cursor;
      break;
    }
    if (!c.body[i]!.startsWith('-')) cursor++;
  }

  const oldLines = c.body.filter((l) => !l.startsWith('+')).length;
  const newLines = c.body.filter((l) => !l.startsWith('-')).length;

  const inputDiff = [
    `diff --git a/${c.path} b/${c.path}`,
    `--- a/${c.path}`,
    `+++ b/${c.path}`,
    `@@ -${c.newStart},${oldLines} +${c.newStart},${newLines} @@`,
    ...c.body,
  ].join('\n');

  return {
    name: c.name,
    expectationKind: c.expectationKind,
    inputDiff,
    notes: c.notes,
    expectation: {
      file: c.path,
      start_line: line,
      end_line: line,
      severity: c.severity,
      category: c.category,
      title: c.title,
    },
  };
}

export const SEED_EVAL_CASES: SeedEvalCase[] = [
  {
    name: 'stripe-key-leak',
    expectationKind: 'must_find',
    path: 'src/config.ts',
    newStart: 10,
    body: [
      ' export const config = {',
      '   port: Number(process.env.PORT ?? 3000),',
      '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
      '   redisUrl: process.env.REDIS_URL,',
      ' };',
    ],
    target: 2,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    notes: 'A live secret committed in plaintext. The canonical positive case.',
  },
  {
    name: 'ssrf-webhook-forwarder',
    expectationKind: 'must_find',
    path: 'src/api/public/webhooks.ts',
    newStart: 61,
    body: [
      ' export async function forward(req: Request) {',
      '   const { target } = await req.json();',
      '+  const res = await fetch(target, { method: "POST", body: req.body });',
      '   return new Response(await res.text());',
      ' }',
    ],
    target: 2,
    severity: 'CRITICAL',
    category: 'security',
    title: 'SSRF: user-supplied URL fetched server-side',
    notes: 'Untrusted input reaches an outbound fetch with no allowlist.',
  },
  {
    name: 'sql-injection-search',
    expectationKind: 'must_find',
    path: 'src/api/search.ts',
    newStart: 22,
    body: [
      ' export async function search(term: string) {',
      '-  return db.query(SEARCH_SQL, [term]);',
      '+  return db.query(`SELECT * FROM docs WHERE title LIKE \'%${term}%\'`);',
      ' }',
    ],
    target: 2,
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL injection via interpolated search term',
    notes: 'A parameterised query replaced with string interpolation.',
  },
  {
    name: 'missing-auth-check',
    expectationKind: 'must_find',
    path: 'src/api/admin/users.ts',
    newStart: 8,
    body: [
      ' router.delete("/users/:id", async (req, res) => {',
      '-  requireRole(req, "admin");',
      '+  // TODO: re-enable once the role service ships',
      '   await users.remove(req.params.id);',
      '   res.status(204).end();',
      ' });',
    ],
    target: 2,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Authorization check removed from a destructive endpoint',
    notes: 'The role guard is commented out on a DELETE route.',
  },
  {
    name: 'n-plus-one-user-list',
    expectationKind: 'must_find',
    path: 'src/api/users.ts',
    newStart: 45,
    body: [
      ' export async function listUsers(ids: string[]) {',
      '   const out = [];',
      '+  for (const id of ids) {',
      '+    out.push(await db.user.findById(id));',
      '+  }',
      '   return out;',
      ' }',
    ],
    target: 3,
    severity: 'WARNING',
    category: 'perf',
    title: 'N+1 query in the user list endpoint',
    notes: 'One query per id inside a loop.',
  },
  {
    name: 'missing-retry-after',
    expectationKind: 'must_find',
    path: 'src/middleware/ratelimit.ts',
    newStart: 50,
    body: [
      '   if (!bucket.take()) {',
      '     res.status(429);',
      '+    res.end("Too Many Requests");',
      '     return;',
      '   }',
    ],
    target: 2,
    severity: 'WARNING',
    category: 'bug',
    title: 'Retry-After header omitted on a 429 response',
    notes: 'A 429 with no Retry-After leaves clients guessing when to retry.',
  },
  {
    name: 'clean-refactor-no-flags',
    expectationKind: 'must_not_flag',
    path: 'src/lib/format.ts',
    newStart: 14,
    body: [
      ' export function formatCost(usd: number): string {',
      '-  return "$" + usd.toFixed(3);',
      '+  return `$${usd.toFixed(3)}`;',
      ' }',
    ],
    target: 2,
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Template literal instead of concatenation',
    notes: 'A behaviour-preserving rewrite. Anything reported here is noise.',
  },
  {
    name: 'test-key-in-fixture',
    expectationKind: 'must_not_flag',
    path: 'test/fixtures/stripe.fixture.ts',
    newStart: 3,
    body: [
      ' export const fixture = {',
      '+  stripeKey: "sk_test_00000000000000000000000000",',
      '   currency: "usd",',
      ' };',
    ],
    target: 1,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Test key in a fixture is not a leak',
    notes:
      'A `sk_test_` placeholder in a fixture file. A prompt that pattern-matches on "sk_" without reading the prefix or the path fires here — which is exactly the false positive precision is meant to catch.',
  },
  {
    name: 'env-var-rename',
    expectationKind: 'must_not_flag',
    path: 'src/config.ts',
    newStart: 30,
    body: [
      ' export const limits = {',
      '-  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),',
      '+  maxUploadMb: Number(process.env.UPLOAD_LIMIT_MB ?? 10),',
      ' };',
    ],
    target: 2,
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Environment variable renamed',
    notes: 'A rename with the default preserved. Not a security finding.',
  },
  {
    name: 'added-unit-test',
    expectationKind: 'must_not_flag',
    path: 'test/ratelimit.test.ts',
    newStart: 40,
    body: [
      ' describe("token bucket", () => {',
      '+  it("refills at the configured rate", () => {',
      '+    expect(bucket.take()).toBe(true);',
      '+  });',
      ' });',
    ],
    target: 2,
    severity: 'SUGGESTION',
    category: 'test',
    title: 'A new passing test is not a defect',
    notes: 'Added coverage. An agent that flags it is padding its finding count.',
  },
];

/** The seed set, materialised. Both polarities, ten cases. */
export const BUILT_EVAL_CASES: BuiltEvalCase[] = SEED_EVAL_CASES.map(buildCase);
