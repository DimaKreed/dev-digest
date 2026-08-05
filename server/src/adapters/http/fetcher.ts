import { lookup } from 'node:dns/promises';
import type { HttpFetcher, HttpFetchOptions, HttpTextResponse } from '@devdigest/shared';
import {
  HttpFetchError,
  hostToIp,
  isBlockedAddress,
  normalizeFetchUrl,
  assertFetchableUrl,
} from './ssrf.js';

/**
 * The only place in the server that GETs a user-supplied URL.
 *
 * Five defenses, all of which have to hold together — dropping any one makes
 * the other four decorative:
 *
 *  1. https only, and no IP literal in a private range   (`ssrf.ts`, pure)
 *  2. DNS resolution, with EVERY returned address checked before the request
 *  3. redirects followed manually, each hop re-validated, same-host only
 *  4. the body is streamed and abandoned past `maxBytes` — never buffered whole
 *  5. one AbortController spanning the whole hop chain, not per request
 *
 * Known residual: between step 2 and the socket connect, `fetch` resolves the
 * name a second time, so a DNS-rebinding attacker with a sub-second TTL could
 * in principle move the answer. Closing that needs connecting to the pinned IP
 * with a manual `Host` header + SNI, which undici does not expose here. The
 * exposure is bounded (one GET, ≤256 KB, text returned to the same user who
 * typed the URL) and is recorded rather than silently ignored.
 */

/** 10 s for the whole chain. A skill is one markdown file; nothing needs longer. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** 256 KB. Larger than any real skill, small enough that a hostile URL is cheap. */
export const DEFAULT_MAX_BYTES = 256 * 1024;

/** GitHub raw redirects at most once; more than a few hops is a redirect loop. */
export const DEFAULT_MAX_REDIRECTS = 3;

const USER_AGENT = 'devdigest-skill-import/1.0';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Resolve `host` and reject if ANY answer is an address we must not contact. */
async function assertPublicHost(host: string): Promise<void> {
  // An IP literal was already classified by `assertFetchableUrl`; resolving it
  // again would just fail (dns.lookup can't take a bracketed IPv6 host).
  const literal = hostToIp(host);
  if (literal) {
    if (isBlockedAddress(literal)) {
      throw new HttpFetchError('That address is private, loopback or link-local');
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new HttpFetchError(`Could not resolve ${host}`);
  }
  if (addresses.length === 0) throw new HttpFetchError(`Could not resolve ${host}`);
  // ALL of them, not the first: a hostile name can answer with one public A
  // record and one 127.0.0.1, and which one the socket picks is not ours.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new HttpFetchError(`${host} resolves to a private, loopback or link-local address`);
    }
  }
}

/** Read the body chunk by chunk, cancelling the stream the moment it overruns. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpFetchError(`Response is larger than ${maxBytes} bytes`);
  }
  if (!res.body) return { text: '', bytes: 0 };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpFetchError(`Response is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    buf.set(chunk, at);
    at += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8').decode(buf), bytes: total };
}

export class GuardedHttpFetcher implements HttpFetcher {
  async fetchText(rawUrl: string, opts: HttpFetchOptions = {}): Promise<HttpTextResponse> {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let url = normalizeFetchUrl(rawUrl);
    const originHost = url.hostname.toLowerCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let hop = 0; ; hop++) {
        await assertPublicHost(url.hostname);

        let res: Response;
        try {
          res = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { accept: 'text/*, application/json;q=0.5, */*;q=0.1', 'user-agent': USER_AGENT },
          });
        } catch (err) {
          if (controller.signal.aborted) throw new HttpFetchError(`Timed out after ${timeoutMs}ms`);
          throw new HttpFetchError(err instanceof Error ? err.message : 'Request failed');
        }

        if (REDIRECT_STATUSES.has(res.status)) {
          if (hop >= maxRedirects) throw new HttpFetchError('Too many redirects');
          const location = res.headers.get('location');
          if (!location) throw new HttpFetchError(`HTTP ${res.status} with no Location header`);
          // Re-validate the TARGET, not the origin — an open redirector is the
          // standard way past a guard that only checks the first URL.
          const next = assertFetchableUrl(new URL(location, url).toString());
          if (next.hostname.toLowerCase() !== originHost) {
            throw new HttpFetchError('Redirect to a different host is not allowed');
          }
          url = next;
          continue;
        }

        if (!res.ok) throw new HttpFetchError(`Fetch failed with HTTP ${res.status}`);
        const { text, bytes } = await readCapped(res, maxBytes);
        return { url: url.toString(), text, contentType: res.headers.get('content-type'), bytes };
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
