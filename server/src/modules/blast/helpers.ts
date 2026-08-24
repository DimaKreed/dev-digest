import type { BlastRadiusResponse, BlastState, PriorPr } from '@devdigest/shared';
import type {
  BlastCallerRead,
  BlastPriorPr,
  BlastRadiusRead,
  IndexStateRead,
  ReverseImpactRead,
} from './ports.js';

/**
 * Blast-radius mapping (ring 0). Pure: no clock, no environment, no I/O.
 *
 * Three things happen here that the repo-intel facade deliberately does not do,
 * because they are presentation concerns of this response rather than facts
 * about the index:
 *
 *  1. The caller cap is applied PER SYMBOL. The facade caps the flat,
 *     rank-sorted array, so one heavily-used file can consume the whole budget
 *     and leave other changed symbols showing zero callers.
 *  2. Endpoints are attributed per caller, not only per symbol. A flat
 *     per-symbol union cannot say which caller reaches which endpoint, and a
 *     graph reading only that union has to draw every caller against every
 *     endpoint.
 *  3. `ok` / `partial` / `degraded` are kept apart. The facade carries one
 *     boolean, which cannot express "the index worked but did not cover
 *     everything" — the state where an empty list is least trustworthy.
 */

/** Per-symbol caller cap. Mirrors the facade's constant, applied after grouping. */
export const MAX_CALLERS_PER_SYMBOL = 20;

/** How many merged PRs the history section shows. */
export const MAX_PRIOR_PRS = 5;

interface FactSet {
  endpoints: Set<string>;
  crons: Set<string>;
}

function emptyFacts(): FactSet {
  return { endpoints: new Set(), crons: new Set() };
}

function mergeInto(target: FactSet, endpoints: string[], crons: string[]): void {
  for (const e of endpoints) target.endpoints.add(e);
  for (const c of crons) target.crons.add(c);
}

/**
 * Endpoints and jobs reachable from each caller file.
 *
 * A reverse-walk row is attributed to every seed it descends from, so an
 * endpoint two import hops out still lands on the caller — and therefore on the
 * changed symbol — it actually belongs to. Depth-0 rows list themselves as their
 * own origin, which is how the facade's direct attribution stays a subset of
 * this rather than being replaced by it.
 */
function factsByCallerFile(blast: BlastRadiusRead, impact: ReverseImpactRead): Map<string, FactSet> {
  const byFile = new Map<string, FactSet>();
  const at = (file: string): FactSet => {
    let f = byFile.get(file);
    if (!f) {
      f = emptyFacts();
      byFile.set(file, f);
    }
    return f;
  };

  for (const [file, facts] of Object.entries(blast.factsByFile ?? {})) {
    mergeInto(at(file), facts.endpoints, facts.crons);
  }
  for (const row of impact.rows) {
    for (const origin of row.originFiles) mergeInto(at(origin), row.endpoints, row.crons);
  }
  return byFile;
}

/**
 * ok / partial / degraded from the index status, the facade's own flag and
 * whether the reverse walk ran out of budget.
 *
 * `partial` is finer than the facade's boolean on purpose: the facade is right
 * that a partial index is still a working index, and this response is making the
 * distinction the facade's single flag cannot carry.
 */
export function deriveState(
  indexStatus: IndexStateRead['status'] | null,
  blast: BlastRadiusRead,
  truncated: boolean,
): { state: BlastState; reason: string | null } {
  if (blast.degraded) return { state: 'degraded', reason: blast.reason ?? 'no_data' };
  if (indexStatus === null) return { state: 'degraded', reason: 'no_data' };
  if (indexStatus === 'degraded' || indexStatus === 'failed') {
    return { state: 'degraded', reason: 'index_failed' };
  }
  if (indexStatus === 'partial') return { state: 'partial', reason: 'index_partial' };
  if (truncated) return { state: 'partial', reason: 'fanout_capped' };
  return { state: 'ok', reason: null };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The `summary` string the contract requires.
 *
 * Deterministic and derived from counts already in hand — no model is consulted
 * on this path. The degraded suffix is load-bearing: an empty result rendered
 * without it reads as a measured "nothing is affected", which is the one
 * conclusion a missing index does not support.
 */
export function buildSummary(
  state: BlastState,
  reason: string | null,
  symbols: number,
  callers: number,
  endpoints: number,
  crons: number,
): string {
  const head =
    `${plural(symbols, 'changed symbol', 'changed symbols')} reach ` +
    `${plural(callers, 'caller', 'callers')}, affecting ` +
    `${plural(endpoints, 'HTTP endpoint', 'HTTP endpoints')} and ` +
    `${plural(crons, 'scheduled job', 'scheduled jobs')}.`;
  if (state === 'ok') return head;
  if (state === 'partial') {
    return `${head} Coverage is incomplete (${reason ?? 'unknown'}) — callers that are absent here are unknown, not absent.`;
  }
  return `${head} No usable index for this repository (${reason ?? 'unknown'}). This is not a statement that the change has no impact.`;
}

function toPriorPr(row: BlastPriorPr): PriorPr {
  return {
    pr_number: row.number,
    title: row.title,
    author: row.author,
    merged_at: row.mergedAt ? row.mergedAt.toISOString() : '',
    files_overlap: [...row.filesOverlap].sort(),
    // Prose about how two PRs relate is a model's job, and this path calls none.
    notes: '',
  };
}

export function toBlastResponse(input: {
  blast: BlastRadiusRead;
  impact: ReverseImpactRead;
  indexStatus: IndexStateRead['status'] | null;
  priorPrs: BlastPriorPr[];
}): BlastRadiusResponse {
  const { blast, impact, indexStatus, priorPrs } = input;

  const changedSymbols = blast.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));
  const declFileOf = new Map(blast.changedSymbols.map((s) => [s.name, s.file]));
  const facts = factsByCallerFile(blast, impact);

  // Group by the symbol reached. `blast.callers` arrives sorted by file rank
  // descending, and a Map preserves insertion order, so each group keeps that
  // order without a second sort.
  //
  // KNOWN LIMIT — grouping is by NAME, so if two changed files each declare a
  // symbol of the same name, their callers merge into one list and both
  // downstream entries show it. The facade cannot tell them apart: a
  // `BlastCallerRow` carries the name it reached (`viaSymbol`) but not the file
  // that declared it, because `getResolvedCallers` filters `decl_file` against
  // the whole changed set and does not return it. Splitting them means carrying
  // `declFile` through the facade row, which is a repo-intel change rather than
  // a mapping one. Until then this over-reports rather than under-reports, which
  // is the safer direction for a blast radius.
  const byVia = new Map<string, BlastCallerRead[]>();
  for (const c of blast.callers) {
    // A reference from inside the declaring file is not a downstream caller.
    // The resolver already excludes these incidentally; stating it here makes
    // the invariant local and testable.
    if (declFileOf.get(c.viaSymbol) === c.file) continue;
    const group = byVia.get(c.viaSymbol);
    if (group) group.push(c);
    else byVia.set(c.viaSymbol, [c]);
  }

  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  let callerCount = 0;

  // Iterate the changed symbols, not the groups: a symbol nothing calls still
  // belongs in the response, with an empty caller list.
  const downstream = changedSymbols.map((sym) => {
    const capped = (byVia.get(sym.name) ?? []).slice(0, MAX_CALLERS_PER_SYMBOL);
    callerCount += capped.length;

    const symEndpoints = new Set<string>();
    const symCrons = new Set<string>();
    const callers = capped.map((c) => {
      const f = facts.get(c.file) ?? emptyFacts();
      for (const e of f.endpoints) {
        symEndpoints.add(e);
        allEndpoints.add(e);
      }
      for (const k of f.crons) {
        symCrons.add(k);
        allCrons.add(k);
      }
      return {
        name: c.symbol,
        file: c.file,
        line: c.line,
        endpoints_affected: [...f.endpoints].sort(),
        crons_affected: [...f.crons].sort(),
      };
    });

    return {
      symbol: sym.name,
      callers,
      // Attributed from the capped set only: an endpoint reachable solely
      // through a caller this response omits should not be advertised.
      endpoints_affected: [...symEndpoints].sort(),
      crons_affected: [...symCrons].sort(),
    };
  });

  const { state, reason } = deriveState(indexStatus, blast, impact.truncatedFrom.length > 0);

  return {
    changed_symbols: changedSymbols,
    downstream,
    summary: buildSummary(
      state,
      reason,
      changedSymbols.length,
      callerCount,
      allEndpoints.size,
      allCrons.size,
    ),
    state,
    reason,
    truncated_files: [...impact.truncatedFrom].sort(),
    prior_prs: priorPrs.map(toPriorPr),
    notes_state: 'absent',
  };
}
