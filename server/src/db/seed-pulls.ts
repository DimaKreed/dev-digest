/**
 * Demo pull requests for the control experiments.
 *
 * Each carries a real `pr_files.patch`, because `diffFromPrFiles`
 * (modules/reviews/diff-loader.ts) reconstructs the unified diff from those
 * patches when no clone is available. That makes every experiment reproducible
 * offline, with no GitHub token and no cloned repo.
 *
 * #483 and #484 are built so the SAME agent behaves differently with and
 * without its skills attached. #485 is built for the PROMPT ablation instead:
 * the contrast there is the same agent with and without its system prompt.
 *
 * PATCH FORMAT: a bare `@@` hunk. Do NOT include `diff --git` / `---` / `+++`
 * lines — `diffFromPrFiles` prepends exactly those three per file, and a second
 * copy would make the parser read the file path off the wrong line. Every body
 * line starts with `+`, `-`, or a single space.
 *
 * The `@@ -old,len +new,len @@` lengths must match the body (old = the ' ' and
 * '-' lines, new = the ' ' and '+' ones) even though this repo's parser does not
 * read them: `parseUnifiedDiff` seeds its cursor from `newStart` alone and
 * counts the body itself, so a wrong length changes no line number here. It is
 * still wrong — `git apply` and every other diff tool reject it, and the
 * `additions`/`deletions` beside it land on the PR row and are shown to the
 * reader. `test/seed-pulls.test.ts` holds both to the body.
 *
 * `newStart` IS load-bearing: get it wrong and every finding on the file is
 * cited at the wrong line, which the citation-grounding gate then drops.
 */

export interface SeedPullFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface SeedPull {
  number: number;
  title: string;
  author: string;
  branch: string;
  headSha: string;
  body: string;
  commitMessage: string;
  files: SeedPullFile[];
}

export const CONTROL_EXPERIMENT_PULLS: SeedPull[] = [
  {
    // Test Quality experiment. Without `test-coverage-nudge` the reviewer tends
    // to accept the suite as present; with it, the undefined-coupon branch, the
    // RangeError path and the 0/100 boundaries are named.
    number: 483,
    title: 'Add percentage coupon support to cart totals',
    author: 'dmitri.hale',
    branch: 'feat/cart-coupons',
    headSha: 'b7c1d9e0a4f2',
    body: 'Adds percentage coupon support to the cart total calculation, with tests.',
    commitMessage: 'Add applyDiscount + test',
    files: [
      {
        path: 'src/lib/discount.ts',
        additions: 14,
        deletions: 0,
        patch: `@@ -0,0 +1,14 @@
+export interface Cart {
+  subtotal: number;
+  couponPercent?: number;
+}
+
+/** Apply a percentage coupon to a cart subtotal. */
+export function applyDiscount(cart: Cart): number {
+  if (cart.couponPercent === undefined) return cart.subtotal;
+  if (cart.couponPercent < 0 || cart.couponPercent > 100) {
+    throw new RangeError('couponPercent must be between 0 and 100');
+  }
+  const discounted = cart.subtotal * (1 - cart.couponPercent / 100);
+  return Math.round(discounted * 100) / 100;
+}`,
      },
      {
        path: 'src/lib/discount.test.ts',
        additions: 8,
        deletions: 0,
        patch: `@@ -0,0 +1,8 @@
+import { describe, it, expect } from 'vitest';
+import { applyDiscount } from './discount';
+
+describe('applyDiscount', () => {
+  it('applies a percentage coupon', () => {
+    expect(applyDiscount({ subtotal: 200, couponPercent: 10 })).toBe(180);
+  });
+});`,
      },
    ],
  },
  {
    // API Contract experiment, run on the existing General Reviewer. The changed
    // signature and the un-updated caller are BOTH visible in the diff — the
    // caller line appears as unchanged context — so the breaking change is
    // detectable without repo access.
    number: 484,
    title: 'Support voided invoices in the invoice endpoint',
    author: 'priya.raman',
    branch: 'feat/invoice-include-void',
    headSha: 'c3f8a1b6d92e',
    body: 'Adds an includeVoid option so the billing UI can show voided invoices.',
    commitMessage: 'Add includeVoid to getInvoice',
    files: [
      {
        path: 'src/api/invoices.ts',
        additions: 6,
        deletions: 4,
        patch: `@@ -10,9 +10,11 @@ import { db } from '../db';
 import { app } from '../server';

-export async function getInvoice(id: string) {
-  return db.invoices.findById(id);
+export async function getInvoice(id: string, opts: { includeVoid: boolean }) {
+  return db.invoices.findById(id, opts.includeVoid);
 }

-app.get('/invoices/:id', async (req) => {
-  return getInvoice(req.params.id);
+app.get('/v2/invoices/:id', async (req) => {
+  return getInvoice(req.params.id, {
+    includeVoid: req.query.includeVoid === 'true',
+  });
 });`,
      },
      {
        path: 'src/jobs/reconcile.ts',
        additions: 1,
        deletions: 1,
        patch: `@@ -6,7 +6,7 @@ import { getInvoice } from '../api/invoices';
 export async function reconcile() {
   const rows = await db.invoices.pending();
   for (const row of rows) {
     const invoice = await getInvoice(row.id);
-    await postToLedger(invoice);
+    await postToLedger(invoice, { retries: 3 });
   }
 }`,
      },
    ],
  },
  {
    // PROMPT ablation experiment (SPEC-04 § the runbook in
    // server/docs/eval-pipeline.md). Run "Security Reviewer (control)" on this
    // PR twice — once with its real system prompt, once with a minimal one —
    // and the eval metrics have to move.
    //
    // The file set is deliberately two-sided, because the two halves move
    // DIFFERENT metrics and a set with only one half cannot show the ablation:
    //
    //   Four real defects → `must_find` cases → RECALL. None of them is a
    //   grep-able pattern; each needs the reviewer to follow control flow (a
    //   swallowed verification, a guard replaced by a comment, a sink fed from
    //   the request body). The single hardcoded secret is the exception, kept
    //   as one stable anchor so a totally broken run is still distinguishable
    //   from a merely worse one.
    //
    //   Four benign changes → `must_not_flag` cases → PRECISION. Every one is
    //   something SECURITY_REVIEWER_PROMPT explicitly forbids reporting: a
    //   style-only refactor, a rename with the default preserved, a `_test_`
    //   placeholder in a fixture, an added passing test. Strip the prompt and
    //   those prohibitions go with it, so the noise lands exactly here.
    number: 485,
    title: 'Add partner webhook relay and account purge endpoint',
    author: 'noah.brandt',
    branch: 'feat/partner-relay',
    headSha: 'd4e7f2a9c1b8',
    body:
      'Adds the partner webhook intake, relays accepted events to the partner callback, ' +
      'and exposes an admin purge endpoint for GDPR requests.',
    commitMessage: 'Add partner relay + purge endpoint',
    files: [
      {
        // must_find — auth bypass. The verification call survives, so a
        // keyword scan sees `verifySignature` and moves on; only following the
        // catch shows that a forged signature now falls through to `process`.
        path: 'src/api/public/partner-webhooks.ts',
        additions: 4,
        deletions: 2,
        patch: `@@ -14,8 +14,10 @@ import { createHmac } from 'node:crypto';
 export async function handlePartnerWebhook(req: Request) {
   const raw = await req.text();
   const signature = req.headers.get('x-partner-signature') ?? '';
-  if (!verifySignature(raw, signature)) {
-    return new Response('bad signature', { status: 401 });
+  try {
+    verifySignature(raw, signature);
+  } catch {
+    // partners occasionally send a legacy signature format; don't hard-fail
   }
   return process(JSON.parse(raw));
 }`,
      },
      {
        // must_find — SSRF. The callback URL comes off the request payload and
        // reaches fetch with no allowlist; the registry lookup is still there
        // as a fallback, which is what makes it read as harmless.
        path: 'src/api/public/relay.ts',
        additions: 5,
        deletions: 2,
        patch: `@@ -22,4 +22,7 @@ import { registry } from '../../partners/registry';
 export async function relay(event: PartnerEvent) {
-  const target = registry.lookup(event.partnerId);
-  await post(target, event.payload);
+  const target = event.payload.callbackUrl ?? registry.lookup(event.partnerId);
+  await fetch(target, {
+    method: 'POST',
+    body: JSON.stringify(event.payload),
+  });
 }`,
      },
      {
        // must_find — the authorization check on a DESTRUCTIVE endpoint is
        // replaced by a TODO. One line, and nothing in it looks like a
        // vulnerability unless you notice what the route does.
        path: 'src/api/admin/purge.ts',
        additions: 1,
        deletions: 1,
        patch: `@@ -8,5 +8,5 @@ import { accounts } from '../../services/accounts';
 router.delete('/accounts/:id/purge', async (req, res) => {
-  requireRole(req, 'admin');
+  // TODO: re-enable once the role service ships
   await accounts.purge(req.params.id);
   res.status(204).end();
 });`,
      },
      {
        // must_find — the stable anchor. Any model finds a live-looking secret,
        // which is the point: it holds recall off the floor when everything
        // else is missed, so a collapse is visible as a partial one.
        path: 'src/config/partners.ts',
        additions: 1,
        deletions: 0,
        patch: `@@ -4,4 +4,5 @@
 export const partners = {
   retries: Number(process.env.PARTNER_RETRIES ?? 3),
+  signingSecret: 'whsec_live_9f3Ka2Vn7PqLm4Rd0bZxYt',
   timeoutMs: 5000,
 };`,
      },
      {
        // must_not_flag — an env var renamed with the default preserved. No
        // behaviour change, no security impact.
        path: 'src/config/limits.ts',
        additions: 1,
        deletions: 1,
        patch: `@@ -3,4 +3,4 @@
 export const limits = {
-  maxPayloadKb: Number(process.env.MAX_PAYLOAD_KB ?? 256),
+  maxPayloadKb: Number(process.env.PAYLOAD_LIMIT_KB ?? 256),
   maxRetries: 3,
 };`,
      },
      {
        // must_not_flag — a style-only refactor. `var` → `const` with the same
        // expression; the prompt's "no style nits" rule covers exactly this.
        path: 'src/lib/format.ts',
        additions: 2,
        deletions: 2,
        patch: `@@ -12,4 +12,4 @@
 export function formatBytes(n: number): string {
-  var kb = n / 1024;
-  return kb.toFixed(1) + ' KB';
+  const kb = n / 1024;
+  return kb.toFixed(1) + ' KB';
 }`,
      },
      {
        // must_not_flag — the decoy. A `whsec_test_` placeholder in a fixture
        // file. An agent pattern-matching on `whsec_` without reading the
        // prefix or the path fires here, and that is the false positive
        // precision is meant to catch.
        path: 'test/fixtures/partner.fixture.ts',
        additions: 1,
        deletions: 0,
        patch: `@@ -2,3 +2,4 @@
 export const partnerFixture = {
+  signingSecret: 'whsec_test_000000000000000000000000',
   partnerId: 'acme-test',
 };`,
      },
      {
        // must_not_flag — added coverage. Flagging a new passing test is
        // padding the finding count, which the prompt forbids by name.
        path: 'test/relay.test.ts',
        additions: 4,
        deletions: 0,
        patch: `@@ -18,2 +18,6 @@ import { relay } from '../src/api/public/relay';
 describe('relay', () => {
+  it('posts the payload to the registered target', async () => {
+    await relay(partnerFixture.event);
+    expect(post).toHaveBeenCalledOnce();
+  });
 });`,
      },
    ],
  },
];
