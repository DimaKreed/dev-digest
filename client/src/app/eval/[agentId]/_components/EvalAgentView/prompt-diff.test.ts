import { describe, it, expect } from "vitest";
import { diffLines, promptsDiffer } from "./prompt-diff";

/**
 * The prompt diff is what turns "precision fell 2 points" into "…because this
 * line was added". It is hand-rolled (this repo ships no diff library), so the
 * cases that matter are the ones an LCS gets wrong when written from memory.
 */
describe("diffLines", () => {
  it("marks every line unchanged when the prompts are equal", () => {
    const p = "a\nb\nc";
    expect(diffLines(p, p).every((l) => l.op === "same")).toBe(true);
  });

  it("reports an inserted line as added and leaves its neighbours alone", () => {
    const out = diffLines("a\nc", "a\nb\nc");
    expect(out.map((l) => `${l.op}:${l.text}`)).toEqual(["same:a", "added:b", "same:c"]);
  });

  it("reports a deleted line as removed", () => {
    const out = diffLines("a\nb\nc", "a\nc");
    expect(out.map((l) => `${l.op}:${l.text}`)).toEqual(["same:a", "removed:b", "same:c"]);
  });

  it("emits the removal before the addition for a changed line", () => {
    // Old-then-new. Interleaved output is unreadable at a glance, which is the
    // only thing this view is for.
    const out = diffLines("keep\nold\ntail", "keep\nnew\ntail");
    expect(out.map((l) => l.op)).toEqual(["same", "removed", "added", "same"]);
  });

  it("handles one side being empty", () => {
    expect(diffLines("", "a\nb").filter((l) => l.op === "added")).toHaveLength(2);
    expect(diffLines("a\nb", "").filter((l) => l.op === "removed")).toHaveLength(2);
  });

  it("keeps every line of both inputs somewhere in the output", () => {
    const before = "one\ntwo\nthree\nfour";
    const after = "one\ntwo point five\nthree\nfour\nfive";
    const out = diffLines(before, after);
    const kept = out.filter((l) => l.op !== "added").map((l) => l.text);
    const produced = out.filter((l) => l.op !== "removed").map((l) => l.text);
    expect(kept).toEqual(before.split("\n"));
    expect(produced).toEqual(after.split("\n"));
  });
});

describe("promptsDiffer", () => {
  it("is false for identical prompts, which is a real answer and not an error", () => {
    expect(promptsDiffer("x", "x")).toBe(false);
    expect(promptsDiffer("x", "y")).toBe(true);
  });
});
