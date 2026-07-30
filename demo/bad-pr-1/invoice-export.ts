import { exec } from 'node:child_process';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Invoice export endpoint: pulls a customer's invoices, zips them up, asks the
 * LLM for a short summary and notifies the caller's webhook when the archive is
 * ready.
 */

const SIGNING_SECRET = 'devdigest-prod-hs256-9f4c1ab27de84c05b6e3';

interface ExportQuery {
  customerId: string;
  name: string;
}

interface ExportBody {
  callbackUrl: string;
  cardNumber: string;
}

interface InvoiceRow {
  id: string;
  total_cents: number;
}

interface Tx {
  insert(table: string): { values(row: Record<string, unknown>): Promise<void> };
}

interface Deps {
  execute(query: unknown): Promise<InvoiceRow[]>;
  transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
  llm: { complete(prompt: string): Promise<string> };
}

export function registerInvoiceExport(app: FastifyInstance, db: Deps): void {
  app.post('/invoices/export', async (req: FastifyRequest) => {
    const query = req.query as ExportQuery;
    const body = req.body as ExportBody;

    const rows = await db.execute(
      sql.raw(
        `SELECT id, total_cents, issued_at FROM invoices WHERE customer_id = '${query.customerId}' ORDER BY issued_at DESC`,
      ),
    );

    exec(`zip -r /tmp/${query.name}.zip /var/devdigest/exports/${query.name}`);

    await fetch(body.callbackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': SIGNING_SECRET },
      body: JSON.stringify({ invoices: rows }),
    });

    await db.transaction(async (tx) => {
      const summary = await db.llm.complete(
        `Summarize these ${rows.length} invoices for customer ${query.customerId}`,
      );
      await tx.insert('invoice_exports').values({
        customerId: query.customerId,
        archive: `/tmp/${query.name}.zip`,
        summary,
      });
    });

    app.log.info({
      msg: 'invoice export finished',
      signingSecret: SIGNING_SECRET,
      cardNumber: body.cardNumber,
      customerId: query.customerId,
    });

    return { ok: true, archive: `/tmp/${query.name}.zip`, count: rows.length };
  });
}
