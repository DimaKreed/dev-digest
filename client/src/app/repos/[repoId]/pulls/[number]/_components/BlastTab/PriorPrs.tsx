/* "Prior PRs touching these files" — merged pull requests that changed some of
   the same files, with a generated note on how each relates to this one.

   The list itself is plain PR history and arrives with the map, for free. The
   notes cost a generation call, so they are fetched once, on the first expand,
   and never again for the life of the component. A failure to annotate leaves
   the list standing: the history is the useful part and must not be hidden by
   the garnish failing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { PriorPr } from "@devdigest/shared";
import { useBlastHistoryNotes } from "@/lib/hooks/blast";
import { s } from "./styles";

export function PriorPrs({ prId, items }: { prId: string | null; items: PriorPr[] }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);
  const notes = useBlastHistoryNotes(prId);

  // One call, on the first expand. `isIdle` is what keeps a collapse/expand
  // cycle from paying for the same notes twice.
  const toggle = () => {
    setOpen((wasOpen) => {
      if (!wasOpen && notes.isIdle && items.length > 0) notes.mutate();
      return !wasOpen;
    });
  };

  const noteFor = (prNumber: number): string | undefined =>
    notes.data?.notes.find((n) => n.pr_number === prNumber)?.note;

  return (
    <section style={s.priorSection}>
      <button type="button" style={s.priorToggle} aria-expanded={open} onClick={toggle}>
        <Icon.History size={13} />
        {t("priorPrs.title")}
        <Badge mono>{items.length}</Badge>
        <Icon.ChevronRight
          size={13}
          style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : undefined }}
        />
      </button>

      {open &&
        (items.length === 0 ? (
          <span style={s.empty}>{t("priorPrs.empty")}</span>
        ) : (
          items.map((pr) => (
            <div key={pr.pr_number} style={s.priorItem}>
              <div style={s.priorHead}>
                <span style={s.priorNumber}>#{pr.pr_number}</span>
                <span style={s.priorTitle}>{pr.title}</span>
              </div>
              <span style={s.meta}>
                {pr.author}
                {pr.merged_at ? ` · ${pr.merged_at.slice(0, 10)}` : ""}
              </span>

              {notes.isPending ? (
                <Skeleton height={14} />
              ) : (
                (() => {
                  const note = noteFor(pr.pr_number);
                  return note ? <p style={s.priorNote}>{note}</p> : null;
                })()
              )}
            </div>
          ))
        ))}

      {open && notes.isError && <span style={s.meta}>{t("priorPrs.notesFailed")}</span>}
    </section>
  );
}
