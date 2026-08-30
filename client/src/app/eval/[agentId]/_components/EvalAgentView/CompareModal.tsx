/* CompareModal — two runs of the same fixed set, side by side (AC-10).

   This is the screen the whole feature exists for: the inputs were frozen, so
   whatever moved between these two runs is the agent. The prompt diff is shown
   directly under the metric deltas because it is the usual cause, and when the
   two prompts are identical the modal says so rather than showing an empty box
   — that is a real answer (the model moved the numbers, not the prompt). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";
import { diffLines } from "./prompt-diff";
import { s } from "./styles";

const COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
  cost: "var(--text-primary)",
} as const;

export function CompareModal({
  from,
  to,
  onClose,
}: {
  /** The OLDER run. */
  from: EvalBatchSummary;
  /** The NEWER run. */
  to: EvalBatchSummary;
  onClose: () => void;
}) {
  const t = useTranslations("eval");

  const oldPrompt = from.system_prompt ?? "";
  const newPrompt = to.system_prompt ?? "";
  const identical = oldPrompt === newPrompt;
  const lines = React.useMemo(
    () => (identical ? [] : diffLines(oldPrompt, newPrompt)),
    [identical, oldPrompt, newPrompt],
  );

  const label = (b: EvalBatchSummary) =>
    b.agent_version == null ? b.batch_id.slice(0, 6) : `v${b.agent_version}`;

  return (
    <Modal
      width={880}
      title={t("compare.title", { from: label(from), to: label(to) })}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <div style={s.compareBody}>
        <div style={s.deltaGrid}>
          <DeltaCard
            label={t("compare.metrics.recall")}
            oldValue={from.metrics.recall}
            newValue={to.metrics.recall}
            color={COLORS.recall}
          />
          <DeltaCard
            label={t("compare.metrics.precision")}
            oldValue={from.metrics.precision}
            newValue={to.metrics.precision}
            color={COLORS.precision}
          />
          <DeltaCard
            label={t("compare.metrics.citation")}
            oldValue={from.metrics.citation_accuracy}
            newValue={to.metrics.citation_accuracy}
            color={COLORS.citation}
          />
          <CostCard
            label={t("compare.metrics.cost")}
            oldValue={from.cost_usd}
            newValue={to.cost_usd}
          />
        </div>

        <div style={{ ...s.sectionLabel, marginTop: 22 }}>{t("compare.promptDiff")}</div>

        {identical ? (
          <div style={s.empty}>{t("compare.identicalPrompt")}</div>
        ) : (
          <>
            <div style={s.diffKey}>
              <span>
                <span style={s.swatch("var(--crit)")} />
                {t("compare.old", { version: label(from) })}
              </span>
              <span>
                <span style={s.swatch("var(--ok)")} />
                {t("compare.new", { version: label(to) })}
              </span>
            </div>
            <div style={s.diffBox}>
              {lines.map((l, i) => (
                <code key={i} style={s.diffLine(l.op)}>
                  {l.op === "added" ? "+ " : l.op === "removed" ? "- " : "  "}
                  {l.text || " "}
                </code>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function DeltaCard({
  label,
  oldValue,
  newValue,
  color,
}: {
  label: string;
  oldValue: number;
  newValue: number;
  color: string;
}) {
  // Points, not percent: these are deltas of a rate, and "2%" for a move from
  // 93 to 91 would be wrong twice over.
  const points = Math.round(newValue * 100) - Math.round(oldValue * 100);
  return (
    <div style={s.deltaCard}>
      <div style={s.deltaLabel}>{label}</div>
      <div style={s.deltaRow}>
        <span className="tnum" style={s.deltaOld}>
          {Math.round(oldValue * 100)}% →
        </span>
        <span className="tnum" style={s.deltaNew(color)}>
          {Math.round(newValue * 100)}%
        </span>
        <span className="tnum" style={s.deltaBadge(points)}>
          {points > 0 ? "▲" : points < 0 ? "▼" : "±"} {Math.abs(points)}pt
        </span>
      </div>
    </div>
  );
}

function CostCard({
  label,
  oldValue,
  newValue,
}: {
  label: string;
  oldValue: number | null;
  newValue: number | null;
}) {
  const known = oldValue != null && newValue != null;
  const delta = known ? newValue - oldValue : 0;
  return (
    <div style={s.deltaCard}>
      <div style={s.deltaLabel}>{label}</div>
      <div style={s.deltaRow}>
        <span className="tnum" style={s.deltaOld}>
          {oldValue == null ? "—" : oldValue.toFixed(2)} →
        </span>
        <span className="tnum" style={s.deltaNew(COLORS.cost)}>
          {newValue == null ? "—" : newValue.toFixed(2)}
        </span>
        {known && (
          // Cheaper is better here, so the colour is inverted relative to the
          // metric cards: a cost that went UP is not an improvement.
          <span className="tnum" style={s.deltaBadge(-delta)}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "±"} {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
