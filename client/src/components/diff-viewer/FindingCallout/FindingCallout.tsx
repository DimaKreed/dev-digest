/* FindingCallout — the review findings on one diff line, in two parts:
   `FindingTag` sits at the right edge of the code row, `FindingDetails` expands
   underneath it. CodeLine owns the open state because the two halves live in
   different parents (inside the row vs. below it). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Card, Markdown, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { cs } from "../comments";
import { lineSeverityTagFor } from "../styles";
import { fs } from "./styles";

/** Icon + word at the right edge of the row. Opens the details below it. */
export function FindingTag({
  findings,
  open,
  onToggle,
}: {
  findings: FindingRecord[];
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("shell");
  const top = findings[0];
  if (!top) return null;
  const sev = SEV[top.severity];
  const SevIcon = Icon[sev.icon];

  // The hover tooltip is a summary; the full text (markdown `rationale`, and a
  // `suggestion` when there is one) lives in the details panel, because a native
  // title cannot render markdown and never appears on a touch device.
  const tip = findings.map((f) => `${SEV[f.severity].label}: ${f.title}`).join("\n");

  return (
    <button
      type="button"
      title={tip}
      aria-expanded={open}
      aria-label={t("diffViewer.findingToggle", {
        severity: t(`diffViewer.severity.${top.severity}`),
        title: top.title,
      })}
      style={lineSeverityTagFor(top.severity)}
      onClick={onToggle}
    >
      <SevIcon size={11} />
      {t(`diffViewer.severity.${top.severity}`)}
      {findings.length > 1 && ` +${findings.length - 1}`}
    </button>
  );
}

/** The full text of every finding tagged on this line. */
export function FindingDetails({ findings }: { findings: FindingRecord[] }) {
  const t = useTranslations("shell");
  return (
    <div style={cs.thread}>
      {findings.map((f) => {
        const sev = SEV[f.severity];
        const SevIcon = Icon[sev.icon];
        return (
          <Card key={f.id}>
            <div style={cs.headRow}>
              <span style={{ ...fs.sevPill, color: sev.c, background: sev.bg }}>
                <SevIcon size={11} />
                {t(`diffViewer.severity.${f.severity}`)}
              </span>
              <span style={fs.title}>{f.title}</span>
            </div>
            <div style={cs.mdBody}>
              <Markdown>{f.rationale}</Markdown>
            </div>
            {f.suggestion && (
              <>
                <div style={fs.subhead}>{t("diffViewer.findingSuggestion")}</div>
                <div style={cs.mdBody}>
                  <Markdown>{f.suggestion}</Markdown>
                </div>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
