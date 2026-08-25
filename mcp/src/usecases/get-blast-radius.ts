/**
 * Ring 2 — what a pull request's changed code can reach.
 *
 * The hazard the stub was written to prevent does not disappear once the tool
 * returns data; it moves one level in. A SHORT answer from a tool called "blast
 * radius" reads as a measured "small impact", and it is only that if the code
 * index was complete. So index health travels all the way to the caller, an
 * absent or unrecognised state is treated as degraded rather than as healthy,
 * and the one empty answer the index actually earned is kept apart from the two
 * that mean nothing.
 */
import type { BlastRadiusBrief, DownstreamImpactBrief } from '../contracts.js';
import { CALLERS_PER_SYMBOL } from '../domain/limits.js';
import type { DevDigestApi } from '../ports.js';
import { resolvePull, type ResolveDeps } from './resolve-target.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface GetBlastRadiusDeps extends ResolveDeps {
  api: DevDigestApi;
}

export interface GetBlastRadiusInput {
  repo: string;
  prNumber: number;
  limit: number;
}

/** `ok` is asserted only when the server said so in as many words. */
export type IndexHealth = 'ok' | 'partial' | 'degraded';

/** One affected symbol, with its callers already capped. */
export interface BlastImpact {
  symbol: string;
  callers: { name: string; file: string; line: number | null; endpoints: string[] }[];
  /** Total callers before `CALLERS_PER_SYMBOL` cut the printed list. */
  callerCount: number;
  endpoints: string[];
  crons: string[];
}

export interface GetBlastRadiusOutput {
  changedSymbols: { name: string; file: string; kind: string | null }[];
  /** Impacts with at least one caller, widest reach first, capped by `limit`. */
  downstream: BlastImpact[];
  summary: string | null;
  returned: number;
  total: number;
  truncated: boolean;
  /** Callers across ALL impacts, before either cap. */
  totalCallers: number;
  endpoints: string[];
  crons: string[];
  indexState: IndexHealth;
  indexReason: string | null;
  /**
   * `not_indexed` — the index could not answer, so the emptiness means nothing.
   * `no_symbols`  — the diff exposed no analysable symbols (config, docs, data).
   * `no_callers`  — symbols were found and nothing calls them. A REAL result.
   * Collapsing the first into the third is this tool's version of reporting a
   * dirty review as clean.
   */
  emptyReason: 'not_indexed' | 'no_symbols' | 'no_callers' | null;
}

/**
 * Anything that is not literally `ok` or `partial` is degraded, a missing value
 * included. A server that does not report its index health has not earned the
 * benefit of the doubt.
 */
export function readIndexHealth(state: string | null | undefined): IndexHealth {
  if (state === 'ok') return 'ok';
  if (state === 'partial') return 'partial';
  return 'degraded';
}

function impactOf(row: DownstreamImpactBrief): BlastImpact {
  const callers = row.callers ?? [];
  return {
    symbol: row.symbol,
    callerCount: callers.length,
    callers: callers.slice(0, CALLERS_PER_SYMBOL).map((c) => ({
      name: c.name,
      file: c.file,
      line: c.line ?? null,
      endpoints: c.endpoints_affected ?? [],
    })),
    endpoints: row.endpoints_affected ?? [],
    crons: row.crons_affected ?? [],
  };
}

export async function getBlastRadius(
  deps: GetBlastRadiusDeps,
  input: GetBlastRadiusInput,
): Promise<UseCaseResult<GetBlastRadiusOutput>> {
  const target = await resolvePull(deps, input.repo, input.prNumber);
  if (!target.ok) return fail(target.failure);

  const result = await deps.api.getBlastRadius(target.value.prId);
  if (!result.ok) return fail(fromApiFailure(result.failure));

  const blast: BlastRadiusBrief = result.value;
  const indexState = readIndexHealth(blast.state);
  const indexReason = blast.reason ?? null;
  const changed = blast.changed_symbols ?? [];
  const downstream = blast.downstream ?? [];

  const impacts = downstream.map(impactOf);
  const withCallers = impacts.filter((i) => i.callerCount > 0);
  const totalCallers = impacts.reduce((n, i) => n + i.callerCount, 0);

  // Widest reach first. The tiebreak on symbol name keeps two identical requests
  // returning the same order — output that reorders between calls reads as
  // instability in the data rather than in the sort.
  const ranked = [...withCallers].sort(
    (a, b) => b.callerCount - a.callerCount || a.symbol.localeCompare(b.symbol),
  );
  const shown = ranked.slice(0, input.limit);

  // Union, not concatenation: one endpoint reached through two changed symbols
  // is one endpoint, and counting it twice inflates the headline number.
  const endpoints = [...new Set(impacts.flatMap((i) => i.endpoints))].sort();
  const crons = [...new Set(impacts.flatMap((i) => i.crons))].sort();

  // Order matters. A degraded OR partial index that produced nothing is
  // `not_indexed`: `no_callers` claims the index covered every changed file,
  // which only a healthy index has done.
  const emptyReason =
    indexState !== 'ok' && ranked.length === 0
      ? 'not_indexed'
      : changed.length === 0
        ? 'no_symbols'
        : ranked.length === 0
          ? 'no_callers'
          : null;

  return ok({
    changedSymbols: changed.map((s) => ({ name: s.name, file: s.file, kind: s.kind ?? null })),
    downstream: shown,
    summary: blast.summary ?? null,
    returned: shown.length,
    total: ranked.length,
    truncated: shown.length < ranked.length,
    totalCallers,
    endpoints,
    crons,
    indexState,
    indexReason,
    emptyReason,
  });
}
