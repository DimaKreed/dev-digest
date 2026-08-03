"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarRow, Button, EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";
import { CATEGORY_COLORS } from "./constants";
import { s } from "./styles";

/**
 * Stats tab.
 *
 * Every run-derived number is scoped to runs where this skill was in the
 * prompt (`run_skills`), and the scope note says so. A single finding is NOT
 * attributed to a single skill — one run concatenates every linked skill into
 * one prompt, so that attribution does not exist and is not invented here.
 *
 * On a freshly seeded DB there are no runs at all, so the empty state is the
 * expected view, not a failure.
 */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) return <Skeleton height={220} />;
  if (isError || !stats) {
    return <ErrorState title={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const acceptRate =
    stats.accept_rate == null ? t("stats.noData") : `${Math.round(stats.accept_rate * 100)}`;
  const maxCategory = Math.max(1, ...stats.findings_by_category.map((c) => c.count));

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label={t("stats.usedBy")} value={stats.used_by} suffix={` ${t("stats.usedByUnit")}`} />
        <MetricCard
          label={t("stats.runsPulled")}
          value={stats.runs_pulled}
          suffix={` ${t("stats.runsPulledUnit")}`}
        />
        <MetricCard
          label={t("stats.acceptRate")}
          value={acceptRate}
          suffix={stats.accept_rate == null ? undefined : "%"}
        />
        <MetricCard label={t("stats.findings")} value={stats.findings_30d} />
      </div>

      <p style={s.scopeNote}>{t("stats.scopeNote")}</p>

      {stats.runs_pulled === 0 && (
        <EmptyState icon="Activity" title={t("stats.empty.title")} body={t("stats.empty.body")} />
      )}

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>{t("stats.agentsUsing")}</div>
          {stats.agents.length === 0 && <span style={s.muted}>{t("stats.noAgents")}</span>}
          {stats.agents.map((a) => (
            <div key={a.id} style={s.agentRow}>
              <Icon.Cpu size={14} style={{ color: "var(--accent)" }} />
              <span style={s.agentName}>{a.name}</span>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
              >
                {t("stats.open")}
              </Button>
            </div>
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>{t("stats.byCategory")}</div>
          {stats.findings_by_category.length === 0 && (
            <span style={s.muted}>{t("stats.noData")}</span>
          )}
          {stats.findings_by_category.map((c, i) => (
            <BarRow
              key={c.category}
              label={c.category}
              value={c.count}
              max={maxCategory}
              color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              suffix={String(c.count)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
