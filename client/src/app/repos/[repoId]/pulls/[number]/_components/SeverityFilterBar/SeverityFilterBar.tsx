/* SeverityFilterBar — the PR's findings tallied per severity, each level a
   toggle that narrows the Agent runs tab to that level only. Counts come from
   the LATEST run of each agent (older re-runs would double-count) and exclude
   dismissed findings, so the number always matches what selecting it reveals.
   The level labels are the contract vocabulary verbatim — not translated. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { SEVERITY_LEVELS, type SeverityCounts } from "@/lib/severity";
import { s } from "./styles";

export function SeverityFilterBar({
  counts,
  active,
  onSelect,
}: {
  counts: SeverityCounts;
  active: Severity | null;
  /** null clears the filter — selecting the active level toggles it off. */
  onSelect: (severity: Severity | null) => void;
}) {
  const t = useTranslations("prReview");
  // An unreviewed PR would render three dead zeros — noise, not information.
  const total = SEVERITY_LEVELS.reduce((sum, sev) => sum + counts[sev], 0);
  if (total === 0 && active == null) return null;

  return (
    <div style={s.root} role="group" aria-label={t("severityFilter.label")}>
      {SEVERITY_LEVELS.map((sev) => (
        <Chip
          key={sev}
          icon={SEV[sev].icon}
          color={SEV[sev].c}
          count={counts[sev]}
          active={active === sev}
          // The active level stays clickable even at 0 — otherwise a filter
          // that just emptied out (last finding dismissed) can't be cleared.
          disabled={counts[sev] === 0 && active !== sev}
          onClick={() => onSelect(active === sev ? null : sev)}
        >
          {sev}
        </Chip>
      ))}
    </div>
  );
}

export default SeverityFilterBar;
