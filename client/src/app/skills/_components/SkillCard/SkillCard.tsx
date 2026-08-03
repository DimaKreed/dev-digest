/* SkillCard — one row in the Skills Lab list: type + source badges, the enabled
   toggle, and the two numbers we can actually compute (linked agents, tokens). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { SOURCE_ICON, TYPE_COLOR, UNTRUSTED_SOURCES } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const del = useDeleteSkill();
  const untrusted = UNTRUSTED_SOURCES.includes(skill.source);

  /**
   * Disabling is destructive once a skill is in use: the server detaches it
   * from every agent, and re-enabling does NOT restore those links. Confirm
   * first, and say how many agents are affected.
   */
  const confirmToggle = (enabled: boolean) => {
    if (!onToggle) return;
    if (!enabled && skill.used_by > 0) {
      const ok = window.confirm(
        t("card.disableConfirm", { name: skill.name, count: skill.used_by }),
      );
      if (!ok) return;
      onToggle(false);
      toast.success(t("card.disabledToast", { name: skill.name, count: skill.used_by }));
      return;
    }
    onToggle(enabled);
  };

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          // Stop the click here or the card's onClick navigates as well.
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={confirmToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.deleteConfirm", { name: skill.name }))) {
              del.mutate(skill.id);
            }
          }}
          disabled={del.isPending}
          title={t("card.deleteTitle")}
          aria-label={t("card.deleteTitle")}
          style={s.iconButton(del.isPending)}
        >
          <Icon.Trash
            size={14}
            style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined}
          />
        </button>
      </div>

      <div style={s.description}>{skill.description || t("card.noDescription")}</div>

      <div style={s.badgeRow}>
        <span style={s.typeChip(TYPE_COLOR[skill.type])}>{t(`listItem.type.${skill.type}`)}</span>
        <Badge color="var(--text-muted)" icon={SOURCE_ICON[skill.source]}>
          {t(`listItem.source.${skill.source}`)}
        </Badge>
        {untrusted && !skill.enabled && (
          <span title={t("listItem.vettingTitle")} style={{ display: "inline-flex" }}>
            <Badge color="var(--warning)">{t("listItem.needsVetting")}</Badge>
          </span>
        )}
      </div>

      {/* Only numbers with a real source. The design's "71% pull / 74% accept"
          per card has no backing data — per-skill run stats live on the Stats
          tab, computed from run_skills. */}
      <div style={s.metaRow}>
        <span>{t("card.usedBy", { count: skill.used_by })}</span>
        <span style={s.dot}>·</span>
        <span>{t("card.tokens", { count: skill.tokens })}</span>
      </div>
    </div>
  );
}
