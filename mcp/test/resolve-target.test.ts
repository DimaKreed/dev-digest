import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../src/adapters/mocks.js';
import { resolvePull, resolveRepoId } from '../src/usecases/resolve-target.js';
import { PULL, REPO, pullsFor } from './fixtures.js';

describe('resolveRepoId', () => {
  it('matches owner/name regardless of how the caller capitalised it', async () => {
    const api = createFakeApi({ repos: [REPO] });

    const result = await resolveRepoId({ api }, 'Acme/Payments-API');

    expect(result).toEqual({ ok: true, value: 'repo-1' });
  });

  it('names the repository when it is not imported', async () => {
    const api = createFakeApi({ repos: [REPO] });

    const result = await resolveRepoId({ api }, 'acme/billing');

    expect(result).toEqual({ ok: false, failure: { kind: 'unknown_repo', repo: 'acme/billing' } });
  });
});

describe('resolvePull', () => {
  it('resolves a pull request number to the id the API uses', async () => {
    const api = createFakeApi({ repos: [REPO], pulls: pullsFor([PULL]) });

    const result = await resolvePull({ api }, 'acme/payments-api', 482);

    expect(result).toEqual({ ok: true, value: { repoId: 'repo-1', prId: 'pr-1' } });
  });

  it('reports an unknown pull request number', async () => {
    const api = createFakeApi({ repos: [REPO], pulls: pullsFor([PULL]) });

    const result = await resolvePull({ api }, 'acme/payments-api', 999);

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'unknown_pull', repo: 'acme/payments-api', prNumber: 999 },
    });
  });

  it('treats a pull request with no local id as not resolvable', async () => {
    // The list endpoint can serve a PR straight from GitHub before it has a row
    // of its own; nothing can be run against one, so it must not resolve.
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor([{ number: 482, title: 'Not imported yet' }]),
    });

    const result = await resolvePull({ api }, 'acme/payments-api', 482);

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'unknown_pull', repo: 'acme/payments-api', prNumber: 482 },
    });
  });
});
