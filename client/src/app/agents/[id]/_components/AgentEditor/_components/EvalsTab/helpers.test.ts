import { describe, it, expect } from "vitest";
import type { EvalCaseDraft, EvalCaseRecord } from "@devdigest/shared";
import {
  draftBody,
  draftFromCase,
  draftFromSeed,
  draftProblem,
  emptyDraft,
  findingSkeleton,
  parseExpected,
  pct,
  readMeta,
} from "./helpers";

const CASE: EvalCaseRecord = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "a1",
  name: "stripe-key-leak",
  expectation_kind: "must_find",
  input_diff: "@@ -10,4 +10,5 @@",
  input_meta: { title: "Add rate limiting", body: "why" },
  expected_output: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
  notes: null,
  source_finding_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  last_run: null,
};

describe("pct", () => {
  it("keeps null null so 'never run' can be told apart from zero", () => {
    expect(pct(null)).toBeNull();
    expect(pct(0)).toBe(0);
    expect(pct(0.826)).toBe(83);
  });
});

describe("parseExpected", () => {
  it("reads a list of locations", () => {
    const out = parseExpected('[{"file":"a.ts","start_line":3,"end_line":5}]');
    expect(out).toEqual([{ file: "a.ts", start_line: 3, end_line: 5 }]);
  });

  it("wraps a single pasted object rather than calling it invalid", () => {
    // Copying one finding out of a review yields `{ … }`. Rejecting that would
    // be true and useless.
    const out = parseExpected('{"file":"a.ts","start_line":3}');
    expect(out).toEqual([{ file: "a.ts", start_line: 3, end_line: 3 }]);
  });

  it("is null for text that is not JSON at all", () => {
    expect(parseExpected("[{")).toBeNull();
    expect(parseExpected("")).toBeNull();
  });

  it("is null for JSON that could never assert anything", () => {
    // A case built from these would look saved and measure nothing.
    expect(parseExpected('["src/config.ts"]')).toBeNull();
    expect(parseExpected('[{"start_line":3}]')).toBeNull();
    expect(parseExpected('[{"file":"  ","start_line":3}]')).toBeNull();
    expect(parseExpected('[{"file":"a.ts","start_line":"nope"}]')).toBeNull();
  });

  it("repairs an end line typed before the start, and floors a line at 1", () => {
    expect(parseExpected('[{"file":"a.ts","start_line":40,"end_line":12}]')).toEqual([
      { file: "a.ts", start_line: 40, end_line: 40 },
    ]);
    expect(parseExpected('[{"file":"a.ts","start_line":0,"end_line":0}]')).toEqual([
      { file: "a.ts", start_line: 1, end_line: 1 },
    ]);
  });

  it("keeps the fields scoring does not match on, for the reader", () => {
    const out = parseExpected(
      '[{"file":"a.ts","start_line":1,"end_line":1,"severity":"CRITICAL","title":"x"}]',
    );
    expect(out?.[0]).toMatchObject({ severity: "CRITICAL", title: "x" });
  });

  it("accepts an empty list as valid JSON, though not as a saveable case", () => {
    expect(parseExpected("[]")).toEqual([]);
  });
});

describe("draftFromCase / draftFromSeed", () => {
  it("carries a saved case over, meta fields split out", () => {
    const d = draftFromCase(CASE);
    expect(d).toMatchObject({
      name: "stripe-key-leak",
      expectationKind: "must_find",
      metaTitle: "Add rate limiting",
      metaBody: "why",
      notes: "",
    });
    expect(parseExpected(d.expectedJson)).toHaveLength(1);
  });

  it("carries a server-built draft over unchanged", () => {
    const seed: EvalCaseDraft = {
      agent_id: "a1",
      agent_name: "Security Reviewer",
      name: "From finding: Hardcoded key",
      expectation_kind: "must_not_flag",
      input_diff: "@@",
      input_meta: null,
      expected_output: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
      source_finding_id: "f1",
      input_files: ["src/config.ts"],
    };
    const d = draftFromSeed(seed);
    expect(d.name).toBe("From finding: Hardcoded key");
    expect(d.expectationKind).toBe("must_not_flag");
    expect(parseExpected(d.expectedJson)?.[0]?.file).toBe("src/config.ts");
  });
});

describe("readMeta", () => {
  it("tolerates jsonb that is null or the wrong shape", () => {
    expect(readMeta(null)).toEqual({ title: "", body: "" });
    expect(readMeta({ title: 7 })).toEqual({ title: "", body: "" });
  });
});

describe("draftProblem", () => {
  it("names the missing name, then the diff, then the expectation", () => {
    expect(draftProblem(emptyDraft())).toBe("nameRequired");
    expect(draftProblem({ ...emptyDraft(), name: "x" })).toBe("diffRequired");
    // "[]" parses, so the blocker is that it asserts nothing — a case that
    // asserts nothing passes every run and inflates the pass count.
    expect(draftProblem({ ...emptyDraft(), name: "x", inputDiff: "@@" })).toBe("expectedEmpty");
    expect(
      draftProblem({ ...emptyDraft(), name: "x", inputDiff: "@@", expectedJson: "[{" }),
    ).toBe("expectedInvalid");
  });

  it("is null once the draft can actually assert something", () => {
    expect(
      draftProblem({
        ...emptyDraft(),
        name: "x",
        inputDiff: "@@",
        expectedJson: '[{"file":"a.ts","start_line":1,"end_line":1}]',
      }),
    ).toBeNull();
  });
});

describe("draftBody", () => {
  it("sends null meta when neither field was filled in", () => {
    const body = draftBody({ ...emptyDraft(), name: " x ", inputDiff: "@@" });
    expect(body.name).toBe("x");
    expect(body.input_meta).toBeNull();
    expect(body.notes).toBeNull();
  });

  it("sends the meta fields when they were", () => {
    const body = draftBody({ ...draftFromCase(CASE) });
    expect(body.input_meta).toEqual({ title: "Add rate limiting", body: "why" });
  });
});

describe("findingSkeleton", () => {
  it("produces something the editor accepts as valid", () => {
    expect(parseExpected(findingSkeleton("src/a.ts"))).toHaveLength(1);
  });
});
