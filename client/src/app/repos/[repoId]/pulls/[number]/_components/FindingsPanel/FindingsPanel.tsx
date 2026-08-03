/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severity = null,
  targetFindingId = null,
  targetNonce = 0,
  onOpenFile,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Page-level severity filter; null shows every level. */
  severity?: Severity | null;
  /** `?finding=` deep-link target — focuses, expands and scrolls to that card. */
  targetFindingId?: string | null;
  targetNonce?: number;
  onOpenFile?: (file: string, startLine: number, endLine: number) => void;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severity),
    [findings, hideLow, severity],
  );

  // A deep-linked finding takes over the j/k focus so the existing `focused`
  // ring marks it, instead of leaving the highlight on whatever was first.
  const targetIdx = targetFindingId ? shown.findIndex((f) => f.id === targetFindingId) : -1;
  React.useEffect(() => {
    if (targetIdx >= 0) setFocusIdx(targetIdx);
  }, [targetIdx, targetNonce]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onOpenFile={onOpenFile}
              scrollTo={i === targetIdx ? targetNonce : undefined}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
