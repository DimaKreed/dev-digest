import { describe, it, expect } from "vitest";
import { parsePatch, parseLineRange, lineInRange } from "./helpers";

describe("parseLineRange", () => {
  it("reads a single line and a range", () => {
    expect(parseLineRange("50")).toEqual({ start: 50, end: 50 });
    expect(parseLineRange("44-48")).toEqual({ start: 44, end: 48 });
  });

  it("normalises a reversed range", () => {
    expect(parseLineRange("48-44")).toEqual({ start: 44, end: 48 });
  });

  it("degrades to no target on junk", () => {
    expect(parseLineRange(null)).toBeNull();
    expect(parseLineRange("")).toBeNull();
    expect(parseLineRange("abc")).toBeNull();
    expect(parseLineRange("1-2-3")).toBeNull();
    expect(parseLineRange("-5")).toBeNull();
  });
});

describe("parsePatch line numbering", () => {
  it("numbers context, additions and deletions from the hunk header", () => {
    const lines = parsePatch(["@@ -10,3 +10,4 @@", " keep", "-gone", "+added", " tail"].join("\n"));

    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["hunk", undefined, undefined],
      ["ctx", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["ctx", 12, 12],
    ]);
  });

  it("restarts numbering at each hunk header", () => {
    const lines = parsePatch(["@@ -1,1 +1,1 @@", " a", "@@ -50,1 +60,1 @@", " b"].join("\n"));
    expect(lines[1]).toMatchObject({ newNo: 1 });
    expect(lines[3]).toMatchObject({ oldNo: 50, newNo: 60 });
  });

  it("ignores the '\\ No newline at end of file' marker", () => {
    // Without the guard the marker counts as a context line and shifts every
    // number after it, silently mis-targeting a deep link.
    const lines = parsePatch(
      ["@@ -1,2 +1,2 @@", " a", "\\ No newline at end of file", " b"].join("\n"),
    );

    expect(lines.map((l) => l.kind)).toEqual(["hunk", "ctx", "ctx"]);
    expect(lines[2]).toMatchObject({ newNo: 2 });
  });

  it("drops the phantom line a trailing newline produces", () => {
    const lines = parsePatch("@@ -1,1 +1,1 @@\n a\n");
    expect(lines).toHaveLength(2);
  });

  it("returns nothing for an absent patch", () => {
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });
});

describe("lineInRange", () => {
  it("matches on the new side only", () => {
    expect(lineInRange({ kind: "add", text: "", newNo: 45 }, 44, 48)).toBe(true);
    expect(lineInRange({ kind: "ctx", text: "", oldNo: 44, newNo: 44 }, 44, 48)).toBe(true);
    expect(lineInRange({ kind: "add", text: "", newNo: 49 }, 44, 48)).toBe(false);
  });

  it("never matches a deleted line — it isn't in the new file", () => {
    expect(lineInRange({ kind: "del", text: "", oldNo: 45 }, 44, 48)).toBe(false);
  });

  it("never matches a hunk header", () => {
    expect(lineInRange({ kind: "hunk", text: "@@ -44,5 +44,5 @@" }, 44, 48)).toBe(false);
  });

  // AC-30 — the file-only deep link (`?file=…` with no `?line`) rests on this
  // predicate. `DiffTarget.start`/`.end` were widened to `number | null` so the
  // target can name a file alone; the two cases below are the mechanism.
  it("AC-30 — a null bound tints NO line, rather than the whole file", () => {
    const line = { kind: "add", text: "", newNo: 45 } as const;

    // The failure this guards is the tempting reading of "no line": treating an
    // absent bound as an open range would paint every row in the file as the
    // thing the reader was pointed at.
    expect(lineInRange(line, null, null)).toBe(false);
    expect(lineInRange(line, 44, null)).toBe(false);
    expect(lineInRange(line, null, 48)).toBe(false);
    expect(lineInRange(line, undefined, undefined)).toBe(false);
  });

  it("AC-30 — widening the bounds did not stop a real range matching", () => {
    // The other half: a null-tolerant predicate that returned `false` for
    // everything would satisfy the case above and silently break every existing
    // `?line=` deep link.
    expect(lineInRange({ kind: "add", text: "", newNo: 45 }, 44, 48)).toBe(true);
    expect(lineInRange({ kind: "ctx", text: "", oldNo: 48, newNo: 48 }, 44, 48)).toBe(true);
  });
});
