/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, HoverCard, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import type { PrMeta } from "@/lib/types";
import { RunCostBadge } from "@/components/RunCostBadge";
import { FindingsHoverList } from "@/components/FindingsHoverList";
import { usePrReviews } from "@/lib/hooks/reviews";
import { latestRunPerAgent, isLiveFinding } from "@/lib/severity";
import { FINDINGS_FIELDS, SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  // Which chip's peek panel is open — used ONLY to gate the fetch. The findings
  // bodies aren't on the list endpoint, so they load once a panel opens; all
  // three chips share `["reviews", pr.id]`, which also warms the detail page.
  const [peek, setPeek] = React.useState<Severity | null>(null);
  const { data: reviews, isLoading: peekLoading } = usePrReviews(pr.id, peek != null);
  // Same scope as the counts above the chips: latest run per agent, no dismissed
  // findings — otherwise a panel would disagree with the number that opened it.
  const liveFindings = React.useMemo(
    () =>
      reviews
        ? latestRunPerAgent(reviews)
            .flatMap((r) => r.findings)
            .filter(isLiveFinding)
        : [],
    [reviews],
  );

  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.findingsCell}>
        {!reviewed ? (
          <span style={s.muted}>—</span>
        ) : (
          FINDINGS_FIELDS.map(({ sev, field }) => {
            const n = pr[field] ?? 0;
            const meta = SEV[sev];
            const SIcon = Icon[meta.icon];
            return (
              <HoverCard
                key={sev}
                disabled={n === 0}
                // Moving between chips races: the one being left closes ~30ms
                // after the next one opens, so only clear if it's still ours.
                onOpenChange={(open) =>
                  setPeek((cur) => (open ? sev : cur === sev ? null : cur))
                }
                trigger={
                  <button
                    type="button"
                    className="tnum"
                    disabled={n === 0}
                    aria-label={t("list.findingsChip", { count: n, severity: sev })}
                    // The row itself navigates on click — without this the chip
                    // would also open the PR unfiltered, and the last push wins.
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(
                        `/repos/${repoId}/pulls/${pr.number}?tab=findings&severity=${sev.toLowerCase()}`,
                      );
                    }}
                    style={s.findingChip(meta.c, n === 0)}
                  >
                    <SIcon size={13} />
                    {n}
                  </button>
                }
              >
                {() => {
                  // Scoped to this chip's own level, not to `peek` — during the
                  // hand-off between two chips both panels are briefly mounted.
                  const items = liveFindings.filter((f) => f.severity === sev);
                  return (
                    <FindingsHoverList
                      findings={items}
                      loading={peekLoading && items.length === 0}
                    />
                  );
                }}
              </HoverCard>
            );
          })
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge usd={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
