/* PageToc — jump links for the five tour sections.
   Titles come from the onboarding namespace keyed by `kind`, exactly as the
   section headings do, so the two can never disagree. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

export function PageToc({ kinds }: { kinds: readonly string[] }) {
  const t = useTranslations("onboarding");
  if (kinds.length === 0) return null;
  return (
    <nav style={s.nav} aria-label={t("sections")}>
      <div style={s.heading}>{t("sections")}</div>
      {kinds.map((kind) => (
        <a key={kind} href={`#onboarding-${kind}`} style={s.link}>
          {t(`sectionTitles.${kind}`)}
        </a>
      ))}
    </nav>
  );
}
