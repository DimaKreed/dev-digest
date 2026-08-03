/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Markdown } from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { FindingSummaryRow } from "@/components/FindingSummaryRow";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  onOpenFile,
  scrollTo,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Opens this finding's file:line in the app's diff viewer. */
  onOpenFile?: (file: string, startLine: number, endLine: number) => void;
  /** Set (to a nonce) when this card is the `?finding=` deep-link target —
   *  expands and scrolls itself into view. */
  scrollTo?: number;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollTo == null) return;
    setExpanded(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollTo]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <FindingSummaryRow
          f={f}
          repoFullName={repoFullName}
          headSha={headSha}
          onOpenFile={onOpenFile}
        />
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
