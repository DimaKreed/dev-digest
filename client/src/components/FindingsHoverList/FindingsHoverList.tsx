/* FindingsHoverList — the body of a findings peek panel: a count header plus a
   FindingSummaryRow per finding, most severe first. Used by the PR list's
   severity chips and by the Agent-runs timeline cards. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingSummaryRow } from "@/components/FindingSummaryRow";
import { SEVERITY_LEVELS } from "@/lib/severity";
import { s } from "./styles";

function bySeverity(a: FindingRecord, b: FindingRecord): number {
  return SEVERITY_LEVELS.indexOf(a.severity) - SEVERITY_LEVELS.indexOf(b.severity);
}

export function FindingsHoverList({
  findings,
  loading,
  headingKey = "count",
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  loading?: boolean;
  /** Which `prReview.findingsPeek` heading to use. */
  headingKey?: "count" | "inThisRun";
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");

  if (loading) {
    return (
      <div style={s.stack}>
        <Skeleton height={14} width={120} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (findings.length === 0) {
    return <div style={s.empty}>{t("findingsPeek.empty")}</div>;
  }

  const sorted = [...findings].sort(bySeverity);
  return (
    <div style={s.stack}>
      <div style={s.heading}>
        <Icon.AlertOctagon size={12} />
        {t(`findingsPeek.${headingKey}`, { count: sorted.length })}
      </div>
      {sorted.map((f) => (
        <div key={f.id} style={s.item}>
          <FindingSummaryRow
            f={f}
            repoFullName={repoFullName}
            headSha={headSha}
            rationaleClamp={2}
          />
        </div>
      ))}
    </div>
  );
}
