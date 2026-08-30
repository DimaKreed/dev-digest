/**
 * A line diff between two system prompts (SPEC-04 AC-10).
 *
 * Written here rather than pulled in as a dependency: this repo ships no diff
 * library, the input is two short prompts, and the whole algorithm is one LCS
 * table. Adding a package for it would be a larger change than the feature.
 *
 * Pure and dependency-free so it is unit-tested without rendering anything.
 */

export type DiffOp = "same" | "added" | "removed";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Longest-common-subsequence line diff.
 *
 * Quadratic in the line count, which is correct for the input: a system prompt
 * is tens of lines. It is NOT a general-purpose diff — do not reach for it to
 * diff a file.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      // A removal is emitted BEFORE the addition that replaced it, so a changed
      // line reads as old-then-new rather than interleaved.
      out.push({ op: "removed", text: a[i]! });
      i++;
    } else {
      out.push({ op: "added", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) out.push({ op: "removed", text: a[i++]! });
  while (j < b.length) out.push({ op: "added", text: b[j++]! });
  return out;
}

/** Whether two prompts differ at all — drives the "identical prompt" note. */
export function promptsDiffer(before: string, after: string): boolean {
  return before !== after;
}
