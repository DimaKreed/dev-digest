import type {
  BlastRadiusResponse,
  BlastState,
  CallerResolution,
  PriorPr,
} from '@devdigest/shared';
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

/**
 * Files whose extracted endpoints are calls, never declarations.
 *
 * `extractEndpoints` is a line regex over source, so it cannot tell
 * `app.get('/health')` from `inject({ url: 'GET /health' })`. In a test file the
 * hits are always the second kind: the endpoints a test EXERCISES. Attributing
 * them as downstream impact is wrong twice over — the endpoint is not declared
 * there, and a test importing your code is not something your change can break
 * for a user. Measured on this repository, eleven integration tests importing
 * `app.ts` accounted for 52 of 57 reported endpoints on a single pull request.
 *
 * Only the FACTS are dropped. A test that calls a changed symbol stays in the
 * caller list, where "your tests cover this" is worth reading.
 */
const TEST_PATH_RE = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Kinds the resolver can never find a caller for.
 *
 * It resolves INVOCATIONS. A type is annotated, not invoked, so "0 callers" on
 * an interface is not a measurement — it is a question that does not apply. On a
 * real 130-symbol pull request 31 rows were these, and they read exactly like
 * the rows that had actually been checked.
 *
 * A kind NOT in this set is treated as callable, including one nobody has seen
 * before: an unrecognised kind should cost a noisy row, never a silent one.
 */
const UNCALLABLE_KINDS: ReadonlySet<string> = new Set(['interface', 'type', 'enum']);

/**
 * Why this symbol's caller list is what it is.
 *
 * Order is load-bearing. A resolved caller outranks the kind label: an interface
 * with a real call site means the extractor mislabelled the kind, and hiding the
 * evidence is the wrong way to react to that.
 */
export function resolutionOf(
  kind: string,
  callers: number,
  mentions: number,
): CallerResolution {
  if (callers > 0) return 'found';
  if (UNCALLABLE_KINDS.has(kind)) return 'not_callable';
  if (mentions === 0) return 'unreferenced';
  return 'unresolved';
}

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
 * Rows from test files are dropped here rather than upstream: see
 * `TEST_PATH_RE`. This is the one place both sources of facts — the facade's
 * direct attribution and the reverse walk's — pass through.
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
    if (TEST_PATH_RE.test(file)) continue;
    mergeInto(at(file), facts.endpoints, facts.crons);
  }
  for (const row of impact.rows) {
    if (TEST_PATH_RE.test(row.file)) continue;
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
  graph?: { edges: number | undefined; files: number },
): { state: BlastState; reason: string | null } {
  if (blast.degraded) return { state: 'degraded', reason: blast.reason ?? 'no_data' };
  if (indexStatus === null) return { state: 'degraded', reason: 'no_data' };
  if (indexStatus === 'degraded' || indexStatus === 'failed') {
    return { state: 'degraded', reason: 'index_failed' };
  }
  // An empty import graph outranks whatever `status` claims. `status` is the
  // indexer's own verdict, and it is computed as "nothing threw" — but
  // `buildEdges` swallows its failures and returns `[]`, so a run can be stamped
  // `full` with no graph at all. Without the graph no reference resolves, so a
  // caller can never be found: reporting `ok` here would present a structural
  // blindness as a measured "nothing calls this code", which is the one
  // conclusion this whole feature exists to prevent.
  if (graph && graph.files > 0 && graph.edges === 0) {
    return { state: 'degraded', reason: 'no_import_graph' };
  }
  if (indexStatus === 'partial') return { state: 'partial', reason: 'index_partial' };
  // A caller list a cap cut short is a subset, and a subset presented as the
  // whole list is the same masking as an empty array standing in for no data.
  // Checked before the reverse-walk cap because it bounds what the reviewer is
  // actually reading — the rows — rather than how far attribution reached.
  if ((blast.cappedSymbols?.length ?? 0) > 0) {
    return { state: 'partial', reason: 'callers_capped' };
  }
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
  /**
   * References per changed-symbol name, resolved or not. A missing entry counts
   * as zero, which is the cautious reading: it makes the row say "nothing
   * mentions this" only when the index actually said so.
   */
  mentions?: Map<string, number>;
  indexStatus: IndexStateRead['status'] | null;
  /** Edges the last index wrote — zero means no caller can ever resolve. */
  indexEdges?: number | undefined;
  /** Files the last index walked, so an empty repo is not read as a broken one. */
  indexFiles?: number | undefined;
  priorPrs: BlastPriorPr[];
}): BlastRadiusResponse {
  const { blast, impact, indexStatus, priorPrs } = input;
  const mentions = input.mentions ?? new Map<string, number>();

  const changedSymbols = blast.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  // Composite key throughout: a symbol is (name, declaring file), never a name.
  const keyOf = (name: string, file: string): string => `${name} ${file}`;
  const facts = factsByCallerFile(blast, impact);

  // Group by the symbol reached. `blast.callers` arrives sorted by file rank
  // descending, and a Map preserves insertion order, so each group keeps that
  // order without a second sort.
  //
  // Grouped by symbol AND declaring file. Grouping on the name alone merged two
  // declarations that share one — `ReviewRepository.getPull` forwarding to
  // `pull.repo.getPull` — and then showed each of them the other's callers: 6
  // such pairs put 19 phantom rows into a list of 136 on one pull request.
  const byVia = new Map<string, BlastCallerRead[]>();
  for (const c of blast.callers) {
    // A reference from inside the declaring file is not a downstream caller.
    // The resolver already excludes these incidentally; stating it here makes
    // the invariant local and testable.
    if (c.viaFile === c.file) continue;
    const key = keyOf(c.viaSymbol, c.viaFile);
    const group = byVia.get(key);
    if (group) group.push(c);
    else byVia.set(key, [c]);
  }

  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  let callerCount = 0;

  // Iterate the changed symbols, not the groups: a symbol nothing calls still
  // belongs in the response, with an empty caller list.
  const downstream = changedSymbols.map((sym) => {
    const capped = (byVia.get(keyOf(sym.name, sym.file)) ?? []).slice(
      0,
      MAX_CALLERS_PER_SYMBOL,
    );
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

    // `mentions` is keyed on the NAME, deliberately: "how often does this
    // repository say `getPull`" is a fact about the name, and two declarations
    // sharing one cannot be told apart by a reference the resolver never tied
    // to either. It only ever decides between two flavours of empty.
    const seen = mentions.get(sym.name) ?? 0;
    return {
      symbol: sym.name,
      file: sym.file,
      callers,
      // Attributed from the capped set only: an endpoint reachable solely
      // through a caller this response omits should not be advertised.
      endpoints_affected: [...symEndpoints].sort(),
      crons_affected: [...symCrons].sort(),
      resolution: resolutionOf(sym.kind, callers.length, seen),
      mentions: seen,
    };
  });

  // Rows carrying an answer first. `downstream` follows the declaration order
  // the index happened to return, so on a large pull request the handful of
  // symbols that actually have callers sit buried among the many that do not —
  // a reviewer scrolls a wall of zeroes and concludes the feature found nothing.
  // Ordering is a presentation concern of this response, which is why it happens
  // here and not in the facade: the tree, the graph and the MCP tool all read
  // this array and all three want the informative rows first.
  //
  // Tiebreak by name so the order is total and the same input always renders
  // identically — `Array.prototype.sort` is stable, but the array it is handed
  // is only as stable as the database's row order.
  downstream.sort(
    (a, b) =>
      b.callers.length - a.callers.length ||
      a.symbol.localeCompare(b.symbol) ||
      // Two declarations of one name would otherwise tie, leaving their order to
      // whatever the database returned.
      a.file.localeCompare(b.file),
  );

  const { state, reason } = deriveState(
    indexStatus,
    blast,
    impact.truncatedFrom.length > 0,
    input.indexFiles === undefined
      ? undefined
      : { edges: input.indexEdges, files: input.indexFiles },
  );

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
