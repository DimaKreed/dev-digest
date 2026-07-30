/* FindingSummaryRow — the one-line identity of a finding: severity icon, title,
   category, file:line and confidence. Extracted from FindingCard's collapsed
   header so the findings hover panel shows the same row instead of inventing a
   third layout (the trace drawer's FindingsSection is already a second one). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

/** "11" for a single line, "11-15" for a range. */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.end_line !== f.start_line ? `${f.start_line}-${f.end_line}` : `${f.start_line}`;
}

export function FindingSummaryRow({
  f,
  repoFullName,
  headSha,
  rationaleClamp,
}: {
  f: FindingRecord;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Show the rationale clamped to this many lines. Omit to hide it entirely
   *  (FindingCard renders the full markdown in its expanded body instead). */
  rationaleClamp?: number;
}) {
  const t = useTranslations("prReview");
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div style={s.root}>
      <div style={s.badgeWrap}>
        <SeverityBadge severity={f.severity as Severity} compact />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.title(muted, dismissed)}>{f.title}</span>
          <CategoryTag category={f.category as Category} />
          {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
          {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
        </div>
        <div style={s.metaRow}>
          <MonoLink href={fileHref}>
            {f.file}:{lineLabel(f)}
          </MonoLink>
          <ConfidenceNum value={f.confidence} />
        </div>
        {rationaleClamp != null && <div style={s.rationale(rationaleClamp)}>{f.rationale}</div>}
      </div>
    </div>
  );
}
