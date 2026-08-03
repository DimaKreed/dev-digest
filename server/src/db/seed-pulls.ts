/**
 * Demo pull requests for the skills control experiment.
 *
 * Each carries a real `pr_files.patch`, because `diffFromPrFiles`
 * (modules/reviews/diff-loader.ts) reconstructs the unified diff from those
 * patches when no clone is available. That makes both experiments reproducible
 * offline, with no GitHub token and no cloned repo.
 *
 * Each PR is built so the SAME agent behaves differently with and without its
 * skills attached — that contrast is the whole point of the lesson.
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
        additions: 9,
        deletions: 0,
        patch: `@@ -0,0 +1,9 @@
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
        patch: `@@ -10,11 +10,13 @@ import { db } from '../db';
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
        patch: `@@ -6,9 +6,9 @@ import { getInvoice } from '../api/invoices';
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
];
