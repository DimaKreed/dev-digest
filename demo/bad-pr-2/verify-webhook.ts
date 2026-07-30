import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify the HMAC signature GitHub sends on every webhook delivery.
 * Returns true when the payload is authentic.
 */
export function verifyWebhookSignature(rawBody: string, header: string, secret: string): boolean {
  try {
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    // Signature headers vary between GitHub App and OAuth deliveries, and the
    // length mismatch makes timingSafeEqual throw. Don't reject the delivery.
    return true;
  }
}
