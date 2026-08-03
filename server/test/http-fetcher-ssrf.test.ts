import { describe, it, expect } from 'vitest';
import {
  assertFetchableUrl,
  HttpFetchError,
  isBlockedAddress,
  normalizeFetchUrl,
  rewriteGitHubBlobUrl,
} from '../src/adapters/http/ssrf.js';

/**
 * SSRF guard — hermetic. URL and IP classification is decidable from the string
 * alone, so none of this needs a socket, a DNS server or a mock: the exact
 * function the adapter calls before every request is called directly here.
 */

const rejects = (url: string) => () => normalizeFetchUrl(url);

describe('scheme allow-list', () => {
  it('accepts https', () => {
    expect(normalizeFetchUrl('https://example.com/skills/rule.md').href).toBe(
      'https://example.com/skills/rule.md',
    );
  });

  it.each(['http://example.com/rule.md', 'file:///etc/passwd', 'data:text/plain,hi', 'ftp://x/y'])(
    'rejects %s',
    (url) => {
      expect(rejects(url)).toThrow(HttpFetchError);
    },
  );

  it('names https in the http:// rejection so the message is actionable', () => {
    expect(rejects('http://example.com/rule.md')).toThrow(/only https/i);
  });

  it('rejects credentials embedded in the URL', () => {
    expect(rejects('https://user:pw@example.com/rule.md')).toThrow(HttpFetchError);
  });
});

describe('blocked address ranges', () => {
  it.each([
    ['loopback', 'https://127.0.0.1/rule.md'],
    ['loopback, non-.1', 'https://127.1.2.3/rule.md'],
    ['cloud metadata / link-local', 'https://169.254.169.254/latest/meta-data/'],
    ['private 10/8', 'https://10.0.0.7/internal/rule.md'],
    ['private 172.16/12', 'https://172.20.1.1/rule.md'],
    ['private 192.168/16', 'https://192.168.1.1/rule.md'],
    ['CGNAT 100.64/10', 'https://100.100.0.1/rule.md'],
    ['this-host 0/8', 'https://0.0.0.0/rule.md'],
    ['IPv6 loopback', 'https://[::1]/rule.md'],
    ['IPv6 unique-local', 'https://[fd00::1]/rule.md'],
    ['IPv6 link-local', 'https://[fe80::1]/rule.md'],
    ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/rule.md'],
    ['IPv4-mapped metadata', 'https://[::ffff:169.254.169.254]/rule.md'],
  ])('rejects %s', (_label, url) => {
    expect(rejects(url)).toThrow(HttpFetchError);
  });

  it('accepts an ordinary public host', () => {
    expect(normalizeFetchUrl('https://raw.githubusercontent.com/o/r/main/SKILL.md').hostname).toBe(
      'raw.githubusercontent.com',
    );
  });

  it('accepts a public IP literal', () => {
    expect(() => assertFetchableUrl('https://93.184.216.34/rule.md')).not.toThrow();
  });

  // 172.15 and 172.32 sit just outside 172.16/12 — an off-by-one here would
  // either block real hosts or open the private range.
  it.each(['172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '9.255.255.255'])(
    'does not over-block %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it('fails closed on something that is not an IP at all', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('github.com → raw.githubusercontent.com rewrite', () => {
  it('rewrites a blob URL', () => {
    expect(rewriteGitHubBlobUrl('https://github.com/acme/skills/blob/main/rules/pr.md')).toBe(
      'https://raw.githubusercontent.com/acme/skills/main/rules/pr.md',
    );
  });

  it('drops viewer-only query and hash', () => {
    expect(
      rewriteGitHubBlobUrl('https://github.com/acme/skills/blob/v2/SKILL.md?plain=1#L4'),
    ).toBe('https://raw.githubusercontent.com/acme/skills/v2/SKILL.md');
  });

  it('leaves a non-blob github URL alone', () => {
    const repo = 'https://github.com/acme/skills';
    expect(rewriteGitHubBlobUrl(repo)).toBe(repo);
  });

  it('leaves a non-github URL alone', () => {
    const other = 'https://example.com/acme/skills/blob/main/x.md';
    expect(rewriteGitHubBlobUrl(other)).toBe(other);
  });

  it('is applied by normalizeFetchUrl, so a pasted blob URL just works', () => {
    expect(normalizeFetchUrl('https://github.com/acme/skills/blob/main/SKILL.md').href).toBe(
      'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
    );
  });
});
