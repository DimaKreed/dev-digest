/* EvalDashboardView — every agent's eval standing in one place (SPEC-04 AC-11).

   Two lists: the agents, each with the metrics of its newest run of the set,
   and the newest runs across all agents. An agent that has never been run is
   listed WITHOUT metrics rather than with zeros — "never measured" and "scored
   zero" are different facts and merging them is how a person concludes their
   agent is broken when it has simply never been run (AC-12). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary, EvalBatchSummary } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useEvalDashboard } from "../../../../lib/hooks/eval";
import { METRIC_COLORS, MetricBar, versionLabel, whenLabel } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("dashboard.defaultTitle")} body={t("dashboard.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const agents = data?.agents ?? [];
  const recent = data?.recent_runs ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.head}>
          <div>
            <h1 style={s.title}>{t("dashboard.defaultTitle")}</h1>
            <div style={s.subtitle}>{t("dashboard.subtitle")}</div>
          </div>
        </div>

        <div style={s.sectionLabel}>
          <Icon.Cpu size={13} />
          {t("dashboard.agentsHeading")}
        </div>

        {isLoading ? (
          <Skeleton height={220} />
        ) : agents.length === 0 ? (
          <EmptyState icon="Cpu" title={t("dashboard.emptyTitle")} body={t("dashboard.emptyBody")} />
        ) : (
          agents.map((a) => <AgentRow key={a.agent_id} a={a} />)
        )}

        <div style={s.sectionLabel}>
          <Icon.History size={13} />
          {t("dashboard.recentRunsAll")}
        </div>

        {recent.length === 0 ? (
          <div style={{ ...s.subtitle, marginTop: 0 }}>{t("dashboard.noRuns")}</div>
        ) : (
          <div style={s.table}>
            <div style={s.th}>
              <span style={s.colAgent}>{t("dashboard.agentColumn")}</span>
              <span style={s.colWhen}>{t("dashboard.table.ranAt")}</span>
              <span style={s.colVersion}>{t("dashboard.versionColumn")}</span>
              <span style={s.colMetric}>{t("dashboard.table.recall")}</span>
              <span style={s.colMetric}>{t("dashboard.table.precision")}</span>
              <span style={s.colMetric}>{t("dashboard.table.citation")}</span>
              <span style={s.colPass}>{t("dashboard.table.pass")}</span>
            </div>
            {recent.map((b) => (
              <RunRow key={b.batch_id} b={b} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AgentRow({ a }: { a: EvalAgentSummary }) {
  const t = useTranslations("eval");
  const m = a.latest?.metrics ?? null;

  const meta = a.latest
    ? t("dashboard.lastRun", {
        version: versionLabel(a.latest.agent_version).replace(/^v/, ""),
        when: whenLabel(a.latest.ran_at),
        passed: a.latest.metrics.traces_passed,
        total: a.latest.metrics.traces_total,
      })
    : a.cases_total > 0
      ? t("dashboard.casesOnly", { count: a.cases_total })
      : t("dashboard.noCases");

  return (
    <Link href={`/eval/${a.agent_id}`} style={s.agentRow}>
      <span style={s.agentIcon}>
        <Icon.Cpu size={17} />
      </span>
      <span style={s.agentMain}>
        <span style={s.agentName}>
          {a.agent_name}
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {a.model}
          </span>
        </span>
        <span style={s.agentMeta}>{meta}</span>
      </span>

      {a.trend.length > 1 && (
        <Sparkline data={a.trend} color={METRIC_COLORS.recall} w={72} h={24} />
      )}

      {m ? (
        <>
          <Metric label={t("dashboard.metrics.recall")} value={m.recall} color={METRIC_COLORS.recall} />
          <Metric label={t("dashboard.metrics.precision")} value={m.precision} color={METRIC_COLORS.precision} />
          <Metric
            label={t("dashboard.metrics.citationAccuracy")}
            value={m.citation_accuracy}
            color={METRIC_COLORS.citation}
          />
        </>
      ) : (
        <span style={{ ...s.metricCell, ...s.muted, fontSize: 12 }}>
          {t("dashboard.neverRun")}
        </span>
      )}
      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
    </Link>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={s.metricCell}>
      <span style={s.metricLabel}>{label}</span>
      <div className="tnum" style={s.metricValue(color)}>
        {Math.round(value * 100)}%
      </div>
    </span>
  );
}

function RunRow({ b }: { b: EvalBatchSummary }) {
  return (
    <Link href={`/eval/${b.agent_id}`} style={s.tr(true)}>
      <span style={s.colAgent}>{b.agent_name}</span>
      <span className="mono" style={{ ...s.colWhen, ...s.muted }}>
        {whenLabel(b.ran_at)}
      </span>
      <span className="mono" style={{ ...s.colVersion, color: "var(--accent)" }}>
        {versionLabel(b.agent_version)}
      </span>
      <span style={s.colMetric}>
        <MetricBar value={b.metrics.recall} color={METRIC_COLORS.recall} />
      </span>
      <span style={s.colMetric}>
        <MetricBar value={b.metrics.precision} color={METRIC_COLORS.precision} />
      </span>
      <span style={s.colMetric}>
        <MetricBar value={b.metrics.citation_accuracy} color={METRIC_COLORS.citation} />
      </span>
      <span className="tnum" style={{ ...s.colPass, fontWeight: 600 }}>
        {b.metrics.traces_passed}/{b.metrics.traces_total}
      </span>
    </Link>
  );
}
