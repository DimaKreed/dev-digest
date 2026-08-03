"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Skeleton, TextInput } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentSkills,
  useSetAgentSkills,
  useSkills,
} from "../../../../../../../lib/hooks/skills";
import { moveId, orderChanged, orderSkills, reorder } from "./helpers";
import { s } from "./styles";

/**
 * Skills tab — attach skills to this agent and set their order.
 *
 * Order matters: it is the order the bodies appear in the assembled prompt.
 * The server stores order as the array index, so attaching and reordering are
 * the same request (`POST /agents/:id/skills { skill_ids }`).
 *
 * A globally disabled skill cannot be attached — it would never reach the
 * prompt, so a checked box for one would be a lie. The API rejects it too, and
 * disabling a skill detaches it everywhere, so "linked ⇒ enabled" always holds.
 */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const [filter, setFilter] = React.useState("");
  // Live order while a drag is in flight; null when not dragging. Keeping it
  // local lets the list reorder under the cursor without a round-trip.
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const { data: skills, isLoading } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const savedIds = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );
  const linkedIds = draft ?? savedIds;

  const commit = (ids: string[]) => setSkills.mutate({ agentId: agent.id, skillIds: ids });

  const toggle = (id: string, on: boolean) =>
    commit(on ? [...linkedIds, id] : linkedIds.filter((x) => x !== id));

  // ---- drag and drop (native HTML5 — no dnd dependency in this repo) -------
  const onDragStart = (id: string) => {
    setDragId(id);
    setDraft(savedIds);
  };
  const onDragOverRow = (overId: string) => {
    if (!dragId || dragId === overId) return;
    setDraft((cur) => reorder(cur ?? savedIds, dragId, overId));
  };
  const onDragEnd = () => {
    // Commit only when the order actually moved; a drag that lands where it
    // started should not write.
    if (draft && orderChanged(draft, savedIds)) commit(draft);
    setDraft(null);
    setDragId(null);
  };

  // Keyboard equivalent, on the same handle. Without this, replacing the ↑/↓
  // buttons with drag-and-drop would leave ordering mouse-only.
  const onHandleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    commit(moveId(savedIds, id, e.key === "ArrowUp" ? -1 : 1));
  };

  const all = skills ?? [];
  const ordered = orderSkills(all, links ?? []);
  const q = filter.trim().toLowerCase();
  const visible = q ? ordered.filter((sk) => sk.name.toLowerCase().includes(q)) : ordered;
  // Denominator counts only what can actually be attached.
  const attachableTotal = all.filter((sk) => sk.enabled).length;

  if (isLoading) return <Skeleton height={200} />;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("skills.enabledCount", { linked: linkedIds.length, total: attachableTotal })}
        </Badge>
        <div style={s.filter}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("skills.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.dragHint")}</p>

      {all.length === 0 && <span style={s.empty}>{ts("page.empty.body")}</span>}

      {visible.map((sk) => {
        const linked = linkedIds.includes(sk.id);
        const attachable = sk.enabled;
        const isDragging = dragId === sk.id;
        // Only a linked row has an order, so only a linked row can be dragged.
        const draggable = linked && attachable;
        return (
          <div
            key={sk.id}
            draggable={draggable}
            onDragStart={draggable ? () => onDragStart(sk.id) : undefined}
            onDragOver={
              dragId
                ? (e) => {
                    e.preventDefault();
                    onDragOverRow(sk.id);
                  }
                : undefined
            }
            onDrop={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            style={{
              ...s.row(linked, attachable, isDragging),
              ...(dragId && dragId !== sk.id && linked ? s.dropTarget : {}),
            }}
          >
            <button
              type="button"
              disabled={!draggable}
              aria-label={t("skills.dragHandle", { name: sk.name })}
              onKeyDown={(e) => onHandleKeyDown(e, sk.id)}
              style={s.handle(draggable)}
            >
              <Icon.Menu size={14} />
            </button>

            <span title={attachable ? undefined : t("skills.cannotAttachDisabled")}>
              <Checkbox
                checked={linked}
                disabled={!attachable}
                onChange={(on) => toggle(sk.id, on)}
              />
            </span>

            <span className="mono" style={s.name}>
              {sk.name}
            </span>

            {!attachable && (
              <span style={s.disabledNote} title={t("skills.cannotAttachDisabled")}>
                {t("skills.disabledTag")}
              </span>
            )}
            <span className="tnum" style={s.tokens}>
              {ts("config.tokens", { count: sk.tokens })}
            </span>
            <Badge color="var(--text-muted)">{ts(`listItem.type.${sk.type}`)}</Badge>
          </div>
        );
      })}
    </div>
  );
}
