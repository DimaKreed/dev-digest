/* Pure helpers for the blast tab. No React, no hooks — the two decisions here
   are about what a caller count MEANS, and both were getting read wrong. */

import type { BlastRadiusResponse, DownstreamNode } from "@devdigest/shared";

/**
 * Symbol kinds that cannot have a caller, ever.
 *
 * The index resolves INVOCATIONS — a call site with a name in front of it. A
 * type is never invoked, it is annotated, so "0 callers" on an interface is not
 * a measurement, it is a question that does not apply. Listing 31 of these among
 * 130 rows is how a reviewer ends up scrolling a wall of zeroes.
 *
 * A kind that is NOT in this set is treated as callable, including one nobody
 * has seen before. That direction is deliberate: an unrecognised kind should
 * cost a noisy row, never a hidden one.
 */
const UNCALLABLE_KINDS: ReadonlySet<string> = new Set(["interface", "type", "enum"]);

export interface SymbolPartition {
  /** Rows worth reading — a caller count here is an answer. */
  callable: DownstreamNode[];
  /** How many rows were set aside as types. Reported, never silently dropped. */
  uncallable: number;
}

/**
 * Split the rows into "a caller count means something" and "it does not".
 *
 * `DownstreamNode` carries only a name, so the kind comes from
 * `changed_symbols`. When two changed files declare the same name the server
 * already merges them into one row, so matching on name is as precise as the
 * response allows.
 */
export function partitionByCallability(
  downstream: DownstreamNode[],
  changedSymbols: BlastRadiusResponse["changed_symbols"],
): SymbolPartition {
  const kindOf = new Map(changedSymbols.map((sym) => [sym.name, sym.kind]));
  const callable: DownstreamNode[] = [];
  let uncallable = 0;

  for (const node of downstream) {
    const kind = kindOf.get(node.symbol);
    // A row with callers is always shown, whatever the index called it: a
    // measured caller outranks a kind label that says there cannot be one.
    if (node.callers.length === 0 && kind !== undefined && UNCALLABLE_KINDS.has(kind)) {
      uncallable += 1;
      continue;
    }
    callable.push(node);
  }

  return { callable, uncallable };
}
