"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/**
 * Preview tab — the body as the reviewing agent receives it.
 *
 * `Markdown` has no `rehype-raw`, so embedded HTML is escaped rather than
 * rendered. That is the right default here: a skill body can come from an
 * archive someone else authored.
 */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("previewTab.title")}</h2>
      <p style={s.subtitle}>{t("previewTab.subtitle")}</p>
      <div style={s.card}>
        {skill.body.trim() ? (
          <Markdown>{skill.body}</Markdown>
        ) : (
          <span style={s.empty}>{t("previewTab.empty")}</span>
        )}
      </div>
    </div>
  );
}
