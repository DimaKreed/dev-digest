/**
 * SSRF guard for the outbound `HttpFetcher` adapter.
 *
 * Everything in this file is PURE — no DNS, no sockets, no clock. URL and IP
 * classification is decidable from the string alone, which is what makes the
 * guard testable without a network: `assertFetchableUrl('https://169.254.169.254/')`
 * throws in a unit test exactly as it does in production.
 *
 * The one impure sibling is `fetcher.ts`, which resolves the hostname through
 * DNS and feeds every returned address back into `isBlockedAddress` here.
 *
 * Threat model: a user pastes a URL into "import a skill from a URL". That URL
 * is attacker-controlled. Without this guard the API would happily GET
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (the cloud
 * metadata endpoint) or any service bound to localhost, and hand the body back.
 */

/** A URL we refuse to fetch, or a fetch that broke a limit. Mapped to 400. */
export class HttpFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

/** Only TLS. `http:` is downgradeable; `file:`/`data:`/`blob:` are not network at all. */
const ALLOWED_PROTOCOL = 'https:';

// ---- IPv4 -----------------------------------------------------------------

/** Strict dotted-quad. Rejects octal/short forms (`0177.1`, `2130706433`). */
export function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Every IPv4 range that must never be reachable from a user-supplied URL.
 * `169.254/16` is the important one: the cloud metadata endpoint lives there.
 */
function isBlockedIpv4(o: number[]): boolean {
  const [a, b] = [o[0]!, o[1]!];
  return (
    a === 0 || //                      0.0.0.0/8      "this host"
    a === 10 || //                     10.0.0.0/8     private
    a === 127 || //                    127.0.0.0/8    loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || //     169.254/16     link-local + metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || //     192.168/16     private
    a >= 224 //                        224/4 multicast + 240/4 reserved + broadcast
  );
}

// ---- IPv6 -----------------------------------------------------------------

/**
 * Expand any IPv6 literal to its 8 hextets, including an embedded IPv4 tail
 * (`::ffff:127.0.0.1`). Returns null when the literal is malformed.
 */
export function parseIpv6(value: string): number[] | null {
  let s = (value.split('%')[0] ?? '').toLowerCase();
  if (!s) return null;

  // An embedded IPv4 tail occupies the last two hextets.
  let v4Tail: number[] | null = null;
  if (s.includes('.')) {
    const colon = s.lastIndexOf(':');
    if (colon === -1) return null;
    const v4 = parseIpv4(s.slice(colon + 1));
    if (!v4) return null;
    v4Tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    s = s.slice(0, colon);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const want = 8 - (v4Tail ? 2 : 0);

  const hextets = (str: string): number[] =>
    str === '' ? [] : str.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));

  const left = hextets(halves[0] ?? '');
  const right = halves.length === 2 ? hextets(halves[1] ?? '') : [];
  if ([...left, ...right].some(Number.isNaN)) return null;

  let head: number[];
  if (halves.length === 2) {
    const fill = want - left.length - right.length;
    if (fill < 0) return null;
    head = [...left, ...new Array<number>(fill).fill(0), ...right];
  } else {
    head = left;
  }
  if (head.length !== want) return null;
  return v4Tail ? [...head, ...v4Tail] : head;
}

function isBlockedIpv6(h: number[]): boolean {
  const zeroHead = (n: number) => h.slice(0, n).every((x) => x === 0);

  if (zeroHead(8)) return true; //                       ::            unspecified
  if (zeroHead(7) && h[7] === 1) return true; //         ::1           loopback
  if ((h[0]! & 0xfe00) === 0xfc00) return true; //       fc00::/7      unique-local
  if ((h[0]! & 0xffc0) === 0xfe80) return true; //       fe80::/10     link-local
  if ((h[0]! & 0xff00) === 0xff00) return true; //       ff00::/8      multicast

  // Forms that carry an IPv4 address in the low 32 bits — ::ffff:10.0.0.1 must
  // be blocked for the same reason 10.0.0.1 is.
  const mapped = zeroHead(5) && h[5] === 0xffff; //      ::ffff:0:0/96 IPv4-mapped
  const compat = zeroHead(6); //                         ::a.b.c.d     IPv4-compatible
  const nat64 = h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0);
  if (mapped || compat || nat64) {
    return isBlockedIpv4([h[6]! >> 8, h[6]! & 0xff, h[7]! >> 8, h[7]! & 0xff]);
  }
  return false;
}

/**
 * The bare IP inside a URL host, or null when the host is a name.
 *
 * WHATWG `URL.hostname` KEEPS the brackets on an IPv6 literal (`'[::1]'`), so
 * feeding it straight to an IP parser silently matches nothing — which reads as
 * "not an IP" and lets `https://[::1]/` through. Strip them here, once.
 */
export function hostToIp(hostname: string): string | null {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (!bare) return null;
  return parseIpv4(bare) || parseIpv6(bare) ? bare : null;
}

/**
 * True when this address must not be contacted. Takes a bare IP string — the
 * DNS resolver in `fetcher.ts` calls it once per resolved address.
 */
export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6) return isBlockedIpv6(v6);
  // Not a parseable IP literal — fail closed rather than guess.
  return true;
}

// ---- URL ------------------------------------------------------------------

/**
 * Rewrite a GitHub *blob* page to its raw equivalent, so a user can paste the
 * URL they actually have in the address bar instead of hunting for "Raw".
 * Anything that isn't that exact shape is returned untouched.
 *
 *   https://github.com/o/r/blob/main/skills/x.md
 *   → https://raw.githubusercontent.com/o/r/main/skills/x.md
 */
export function rewriteGitHubBlobUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return raw;

  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repo, blob, ref, ...rest] = segments;
  if (blob !== 'blob' || !owner || !repo || !ref || rest.length === 0) return raw;

  // Query/hash are page-viewer state (`?plain=1`, `#L4`) and mean nothing to raw.
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join('/')}`;
}

/**
 * Parse + statically validate a URL: https only, and if the host is an IP
 * literal it must not be in a blocked range. A *hostname* still has to clear
 * the DNS check in `fetcher.ts` — this function never resolves anything.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpFetchError('Not a valid URL');
  }
  if (url.protocol !== ALLOWED_PROTOCOL) {
    throw new HttpFetchError(`Only https:// URLs can be fetched (got ${url.protocol}//)`);
  }
  if (!url.hostname) throw new HttpFetchError('URL has no host');
  if (url.username || url.password) {
    throw new HttpFetchError('URLs with embedded credentials are not allowed');
  }

  // An IP literal is decidable right now; a hostname still has to clear DNS.
  const literal = hostToIp(url.hostname);
  if (literal && isBlockedAddress(literal)) {
    throw new HttpFetchError('That address is private, loopback or link-local');
  }
  return url;
}

/** `assertFetchableUrl` after the GitHub convenience rewrite. */
export function normalizeFetchUrl(raw: string): URL {
  return assertFetchableUrl(rewriteGitHubBlobUrl(raw.trim()));
}
