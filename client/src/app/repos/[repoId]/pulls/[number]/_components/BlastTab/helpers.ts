/* Pure helpers for the blast tab. No React, no hooks — the one decision here is
   which rows belong in the tree, and it is now the server's `resolution` that
   decides rather than a kind heuristic duplicated on this side. */

import type { BlastRadiusResponse, DownstreamNode } from "@devdigest/shared";

export interface UncallableSymbol {
  name: string;
  file: string;
  kind: string;
}

export interface SymbolPartition {
  /** Rows worth reading — a caller count here is an answer of some kind. */
  callable: DownstreamNode[];
  /**
   * Types and interfaces, with the file that declares each. Set aside for their
   * own section rather than dropped: "these exist and the question does not
   * apply to them" is information, and silently losing 31 of 130 changed
   * symbols is not.
   */
  uncallable: UncallableSymbol[];
}

/**
 * Split the rows on whether a caller count can mean anything for them.
 *
 * The server sends `resolution: 'not_callable'` for interfaces, type aliases and
 * enums — the index resolves invocations, and a type is annotated rather than
 * invoked. It already applies the rule that a resolved caller outranks the kind
 * label, so this side only has to honour the verdict.
 *
 * A row whose `resolution` this build does not recognise stays in the tree. An
 * unfamiliar value should cost a noisy row, never a hidden one.
 */
export function partitionByResolution(
  downstream: DownstreamNode[],
  changedSymbols: BlastRadiusResponse["changed_symbols"],
): SymbolPartition {
  const declOf = new Map(changedSymbols.map((sym) => [sym.name, sym]));
  const callable: DownstreamNode[] = [];
  const uncallable: UncallableSymbol[] = [];

  for (const node of downstream) {
    if (node.resolution === "not_callable") {
      const decl = declOf.get(node.symbol);
      uncallable.push({
        name: node.symbol,
        file: decl?.file ?? "",
        kind: decl?.kind ?? "",
      });
      continue;
    }
    callable.push(node);
  }

  return { callable, uncallable };
}
