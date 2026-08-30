/* ExpectedVsActual — what the case asserted, next to what the agent actually said.

   The verdict per expectation is NOT recomputed here. `run.missed` and
   `run.violations` come from the scorer, which owns the one implementation of
   "same file, overlapping lines"; a second copy in the browser would eventually
   disagree with the recall printed beside it, and the disagreement would be
   invisible until someone chased it. So this component only renders. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { EvalCaseRun, EvalExpectation, EvalExpectationKind, Finding } from "@devdigest/shared";
import { s } from "./styles";

export function ExpectedVsActual({
  expected,
  kind,
  run,
  actualOnly,
}: {
  expected: EvalExpectation[];
  kind: EvalExpectationKind;
  /** The run to show, or null when the case has never been run. */
  run: EvalCaseRun | null;
  /**
   * Drop the expected pane. The case editor already shows the expectations as
   * the JSON the user is editing; repeating them beside it would be two
   * editable-looking copies of the same list, one of which is not editable.
   */
  actualOnly?: boolean;
}) {
  const t = useTranslations("eval");

  const missedKeys = new Set((run?.missed ?? []).map(locKey));
  const violationIds = new Set((run?.violations ?? []).map((f) => f.id));

  return (
    <div style={actualOnly ? s.singlePane : s.compareGrid}>
      {/* Not hidden with CSS — NOT rendered. A pane kept in the DOM under
          `display:none` is still read by screen readers and still matched by
          `getByText`, so the "one location" the editor shows would silently be
          two. */}
      {!actualOnly && (
      <div>
        <div style={s.paneLabel}>
          {t("caseEditor.expectedOutput")}
          <Badge color={kind === "must_find" ? "var(--ok)" : "var(--crit)"}>
            {t(`expectation.${kind}`)}
          </Badge>
        </div>
        {expected.length === 0 ? (
          <div style={s.empty}>{t("compareCase.noExpectations")}</div>
        ) : (
          <div style={s.list}>
            {expected.map((e, i) => {
              // Before the first run nothing is a miss and nothing is a hit —
              // the rows render neutral rather than green, which would claim a
              // result that was never measured.
              const state = !run ? "unknown" : missedKeys.has(locKey(e)) ? "bad" : "good";
              return <LocationRow key={i} state={state} file={e.file} start={e.start_line} end={e.end_line} title={e.title ?? undefined} severity={e.severity ?? undefined} />;
            })}
          </div>
        )}
      </div>
      )}

      <div>
        <div style={actualOnly ? s.hidden : s.paneLabel}>
          {t("compareCase.actualOutput")}
          {run && (
            <span style={s.paneMeta}>
              {t("compareCase.ranAt", { when: shortTime(run.ran_at) })}
            </span>
          )}
        </div>

        {!run ? (
          <div style={s.empty}>{t("compareCase.neverRun")}</div>
        ) : run.error ? (
          // An errored run is not a failed assertion: it never made one.
          <div style={s.errorBox}>
            <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{run.error}</span>
          </div>
        ) : run.findings.length === 0 ? (
          <div style={s.empty}>{t("compareCase.noFindings")}</div>
        ) : (
          <div style={s.list}>
            {run.findings.map((f) => (
              <LocationRow
                key={f.id}
                // In a must_not_flag case a finding at the forbidden location IS
                // the failure, so the colours invert relative to the left pane.
                state={violationIds.has(f.id) ? "bad" : kind === "must_find" ? "good" : "neutral"}
                file={f.file}
                start={f.start_line}
                end={f.end_line}
                title={f.title}
                severity={f.severity}
              />
            ))}
          </div>
        )}

        {run && !run.error && <RunVerdict run={run} kind={kind} />}
      </div>
    </div>
  );
}

function RunVerdict({ run, kind }: { run: EvalCaseRun; kind: EvalExpectationKind }) {
  const t = useTranslations("eval");
  const c = run.counts;
  const detail =
    kind === "must_find"
      ? t("compareCase.foundOf", { found: c?.tp ?? 0, total: (c?.tp ?? 0) + (c?.fn ?? 0) })
      : t("compareCase.violations", { count: c?.fp ?? 0 });

  return (
    <div style={s.verdict(run.pass === true)}>
      <Icon.Check size={14} style={{ flexShrink: 0, opacity: run.pass ? 1 : 0 }} />
      <strong>{run.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}</strong>
      <span style={s.paneMeta}>
        {detail}
        {run.duration_ms != null ? ` · ${(run.duration_ms / 1000).toFixed(1)}s` : ""}
        {run.cost_usd != null ? ` · $${run.cost_usd.toFixed(4)}` : ""}
      </span>
    </div>
  );
}

function LocationRow({
  state,
  file,
  start,
  end,
  title,
  severity,
}: {
  state: "good" | "bad" | "neutral" | "unknown";
  file: string;
  start: number;
  end: number;
  title?: string | undefined;
  severity?: Finding["severity"] | undefined;
}) {
  return (
    <div style={s.locRow(state)}>
      <div style={s.locHead}>
        <span className="mono" style={s.locFile}>
          {file}:{start}
          {end !== start ? `-${end}` : ""}
        </span>
        {severity && <span style={s.locSeverity(severity)}>{severity}</span>}
      </div>
      {title && <div style={s.locTitle}>{title}</div>}
    </div>
  );
}

/** Identity of a location, for matching a missed expectation back to its row. */
function locKey(e: EvalExpectation): string {
  return `${e.file}:${e.start_line}:${e.end_line}`;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
