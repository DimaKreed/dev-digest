/* FindingSummaryRow — the one-line identity of a finding: severity icon, title,
   category, file:line and confidence. Extracted from FindingCard's collapsed
   header so the findings hover panel shows the same row instead of inventing a
   third layout (the trace drawer's FindingsSection is already a second one). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
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
  onOpen,
  onOpenFile,
}: {
  f: FindingRecord;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Show the rationale clamped to this many lines. Omit to hide it entirely
   *  (FindingCard renders the full markdown in its expanded body instead). */
  rationaleClamp?: number;
  /** Makes the whole row a control that opens this finding. Omit inside
   *  FindingCard, whose header already owns the click (expand/collapse). */
  onOpen?: () => void;
  /** Opens the finding's file:line in the app's own diff viewer. */
  onOpenFile?: (file: string, startLine: number, endLine: number) => void;
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
    <div
      style={s.root(!!onOpen)}
      {...(onOpen
        ? {
            role: "button",
            tabIndex: 0,
            // Stop here rather than relying on the container: this row is a
            // control, and it's routinely nested inside another one.
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onOpen();
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onOpen();
              }
            },
          }
        : {})}
    >
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
          {/* In-app first: opens our own diff at this file and line range.
              MonoLink stops propagation on both branches, so this never also
              triggers the row's own open or FindingCard's expand. */}
          <MonoLink
            onClick={
              onOpenFile ? () => onOpenFile(f.file, f.start_line, f.end_line) : undefined
            }
            href={onOpenFile ? undefined : fileHref}
          >
            {f.file}:{lineLabel(f)}
          </MonoLink>
          {onOpenFile && fileHref && (
            <a
              href={fileHref}
              target="_blank"
              rel="noopener noreferrer"
              title={t("finding.viewOnGithub")}
              aria-label={t("finding.viewOnGithub")}
              onClick={(e) => e.stopPropagation()}
              style={s.githubLink}
            >
              <Icon.ExternalLink size={12} />
            </a>
          )}
          <ConfidenceNum value={f.confidence} />
        </div>
        {rationaleClamp != null && <div style={s.rationale(rationaleClamp)}>{f.rationale}</div>}
      </div>
    </div>
  );
}
