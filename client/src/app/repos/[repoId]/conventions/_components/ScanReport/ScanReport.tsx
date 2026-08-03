/* ScanReport — the extractor's own scorecard for one scan, collapsed by default.
   This is the feature's honesty surface: how much the model proposed, how much
   survived verification in the clone, and why the rest was dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";
import type { ExtractionStats } from "@devdigest/shared";
import { formatCost } from "@/lib/format-usage";
import { s } from "./styles";

/** The three drop reasons, in the order verification applies them. */
const DROP_KEYS = [
  ["droppedNoFile", "dropped_no_file"],
  ["droppedNoSnippet", "dropped_no_snippet"],
  ["droppedSingleOccurrence", "dropped_single_occurrence"],
] as const;

export function ScanReport({
  stats,
  open,
  onToggle,
}: {
  stats: ExtractionStats;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("conventions");

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <Icon.Gauge size={14} style={{ color: "var(--text-muted)" }} />
        <span style={s.headTitle}>{t("stats.title")}</span>
        <span style={s.headSummary}>
          {stats.proposed} → {stats.verified}
        </span>
        <div style={s.headAction}>
          <Button
            kind="tertiary"
            size="sm"
            icon={open ? "ChevronDown" : "ChevronRight"}
            onClick={onToggle}
          >
            {open ? t("stats.hide") : t("stats.show")}
          </Button>
        </div>
      </div>

      {open && (
        <div style={s.body}>
          <div style={s.funnel}>
            <div style={s.bigStat(false)}>
              <div style={s.bigNum(false)} className="tnum">
                {stats.proposed}
              </div>
              <div style={s.bigLabel}>{t("stats.proposed")}</div>
            </div>
            <div style={s.bigStat(true)}>
              <div style={s.bigNum(true)} className="tnum">
                {stats.verified}
              </div>
              <div style={s.bigLabel}>{t("stats.verified")}</div>
            </div>
          </div>

          <div>
            {DROP_KEYS.map(([key, field]) => {
              const count = stats[field];
              return (
                <div key={key} style={s.dropRow(count === 0)}>
                  <span>{t(`stats.${key}`)}</span>
                  <span className="tnum" style={s.dropCount(count === 0)}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={s.meta}>
            <span style={s.metaItem}>
              <Icon.File size={12} />
              {t("stats.sampledFiles")}: <b className="tnum">{stats.sampled_files}</b>
            </span>
            <span style={s.metaItem}>
              <Icon.Cpu size={12} />
              {t("stats.model")}:{" "}
              <b className="mono">
                {stats.provider}/{stats.model}
              </b>
            </span>
            <span style={s.metaItem}>
              <Icon.DollarSign size={12} />
              {t("stats.cost")}: <b className="mono tnum">{formatCost(stats.cost_usd)}</b>
            </span>
          </div>

          {stats.config_files.length > 0 && (
            <div style={s.meta}>
              <span style={s.metaItem}>{t("stats.configFiles")}:</span>
              <div style={s.configFiles}>
                {stats.config_files.map((f) => (
                  <Badge key={f} mono>
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
