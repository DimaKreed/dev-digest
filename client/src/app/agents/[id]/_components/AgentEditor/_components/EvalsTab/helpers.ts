import type {
  EvalCaseDraft,
  EvalCaseRecord,
  EvalExpectation,
  EvalExpectationKind,
} from "@devdigest/shared";

/** Pure helpers for the Evals tab. */

/** A rate (0–1) as whole percent. `null` stays null so "never run" can render. */
export function pct(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Math.round(v * 100);
}

/** A signed delta (0–1) as whole points, for the metric tiles. */
export function deltaPoints(v: number): number {
  return Math.round(v * 100);
}

/**
 * The form state a case editor edits.
 *
 * `expectedJson` is the RAW text of the expected-output editor, not a parsed
 * value. Parsing on every keystroke and storing the result would make the field
 * un-typeable — a half-written `[{ "file":` is invalid JSON, and rewriting the
 * textarea from a failed parse eats the character just entered. So the text is
 * the state, and `parseExpected` is applied at the edges (validity badge, run,
 * save).
 */
export interface CaseDraft {
  name: string;
  expectationKind: EvalExpectationKind;
  inputDiff: string;
  /** PR meta, kept as its own fields so the `PR meta` tab can edit them. */
  metaTitle: string;
  metaBody: string;
  notes: string;
  expectedJson: string;
}

/** A blank draft for the "new case" path. */
export function emptyDraft(): CaseDraft {
  return {
    name: "",
    expectationKind: "must_find",
    inputDiff: "",
    metaTitle: "",
    metaBody: "",
    notes: "",
    expectedJson: "[]",
  };
}

/** An existing case as a draft. */
export function draftFromCase(c: EvalCaseRecord): CaseDraft {
  const meta = readMeta(c.input_meta);
  return {
    name: c.name,
    expectationKind: c.expectation_kind,
    inputDiff: c.input_diff,
    metaTitle: meta.title,
    metaBody: meta.body,
    notes: c.notes ?? "",
    expectedJson: formatExpected(c.expected_output),
  };
}

/** A server-built draft (seeded from a finding) as editor state. */
export function draftFromSeed(d: EvalCaseDraft): CaseDraft {
  const meta = readMeta(d.input_meta);
  return {
    name: d.name,
    expectationKind: d.expectation_kind,
    inputDiff: d.input_diff,
    metaTitle: meta.title,
    metaBody: meta.body,
    notes: "",
    expectedJson: formatExpected(d.expected_output),
  };
}

/** `input_meta` jsonb → the two fields the PR meta tab edits. */
export function readMeta(raw: unknown): { title: string; body: string } {
  const m = (raw ?? {}) as { title?: unknown; body?: unknown };
  return {
    title: typeof m.title === "string" ? m.title : "",
    body: typeof m.body === "string" ? m.body : "",
  };
}

/** Expectations as the pretty JSON the editor shows. */
export function formatExpected(list: EvalExpectation[]): string {
  return JSON.stringify(list, null, 2);
}

/**
 * The editor text as expectations, or `null` when it is not valid.
 *
 * A bare object is accepted and wrapped: a person pasting one finding from a
 * review pastes `{ … }`, and rejecting that as "invalid JSON" would be true and
 * useless. Anything else — a string, a number, an array of junk — is rejected,
 * because a case built from it would assert nothing while looking saved.
 */
export function parseExpected(text: string): EvalExpectation[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const out: EvalExpectation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const e = item as Record<string, unknown>;
    if (typeof e.file !== "string" || e.file.trim().length === 0) return null;
    const start = Number(e.start_line);
    const end = Number(e.end_line ?? e.start_line);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    out.push({
      ...(e as object),
      file: e.file.trim(),
      start_line: Math.max(1, Math.trunc(start)),
      // An end before the start is a typo, not an assertion about a reversed
      // range; the scorer normalises it anyway, so store it readable.
      end_line: Math.max(Math.max(1, Math.trunc(start)), Math.trunc(end)),
    } as EvalExpectation);
  }
  return out;
}

/** One expectation, pre-filled — the "Finding skeleton" button. */
export function findingSkeleton(file = "src/config.ts"): string {
  return formatExpected([
    {
      file,
      start_line: 1,
      end_line: 1,
      severity: "CRITICAL",
      category: "security",
      title: "",
    },
  ]);
}

/**
 * Why a draft cannot be saved yet, or null when it can.
 *
 * Returns a key under the `caseEditor` namespace rather than a sentence: the
 * component owns the wording, this owns the rule.
 */
export function draftProblem(
  d: CaseDraft,
): "nameRequired" | "diffRequired" | "expectedInvalid" | "expectedEmpty" | null {
  if (d.name.trim().length === 0) return "nameRequired";
  if (d.inputDiff.trim().length === 0) return "diffRequired";
  const parsed = parseExpected(d.expectedJson);
  if (parsed === null) return "expectedInvalid";
  // A case that asserts nothing passes every run and measures nothing, which is
  // worse than no case: it inflates the pass count.
  if (parsed.length === 0) return "expectedEmpty";
  return null;
}

/** The body both the dry run and the save send. */
export function draftBody(d: CaseDraft) {
  const meta =
    d.metaTitle.trim() || d.metaBody.trim()
      ? { title: d.metaTitle.trim(), body: d.metaBody.trim() }
      : null;
  return {
    name: d.name.trim(),
    expectation_kind: d.expectationKind,
    input_diff: d.inputDiff,
    input_meta: meta,
    expected_output: parseExpected(d.expectedJson) ?? [],
    notes: d.notes.trim() === "" ? null : d.notes.trim(),
  };
}
