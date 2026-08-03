/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** A file + line range to scroll to and highlight, from `?file=…&line=44-48`. */
export interface DiffTarget {
  path: string;
  start: number;
  end: number;
  /** Bumped per navigation so re-selecting the same target scrolls again. */
  nonce: number;
}

/** `"44-48"` → `{ start: 44, end: 48 }`, `"50"` → `{ start: 50, end: 50 }`.
 *  Null on anything else, so a hand-edited URL degrades to "no target". */
export function parseLineRange(raw: string | null | undefined): { start: number; end: number } | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = parseInt(m[1]!, 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  return end < start ? { start: end, end: start } : { start, end };
}

/** Is this rendered line inside the target range? Matches on the NEW side —
 *  findings describe the head version, the same preference `commentTargetFor`
 *  encodes — so deleted lines never match, which is correct. */
export function lineInRange(ln: Line, start: number, end: number): boolean {
  return ln.kind !== "hunk" && ln.newNo != null && ln.newNo >= start && ln.newNo <= end;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  const raws = patch.split("\n");
  // A patch ending in "\n" yields a trailing "" that would otherwise be parsed
  // as a real context line and consume a line number.
  if (raws[raws.length - 1] === "") raws.pop();
  for (const raw of raws) {
    // "\ No newline at end of file" is a marker, not a line of the file — the
    // catch-all below would count it and shift every number after it.
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}
