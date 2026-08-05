"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Icon } from "@devdigest/ui";
import type { SkillSafetyVerdict } from "@devdigest/shared";
import { s, TONE_COLOR, type Tone } from "./styles";

/**
 * The injection-scan result for an imported skill body.
 *
 * The state that matters most is a null verdict — the app boots with zero API
 * keys, so "we could not check this" is common and must never be rendered as a
 * clean bill of health. It gets its own box saying so in as many words, not a
 * missing badge the user reads as "fine".
 *
 * Reasons are shown as VERBATIM quotes from the body. The user is the one
 * deciding whether to trust a stranger's instructions, so they get the
 * evidence, not just the label.
 */
const GLYPH: Record<Tone, keyof typeof Icon> = {
  safe: "CheckCircle",
  suspicious: "AlertTriangle",
  unsafe: "AlertOctagon",
  unscanned: "Info",
};

export function SafetyVerdict({
  verdict,
  acknowledged,
  onAcknowledge,
}: {
  /** null/undefined ⇒ the scan could not run (no provider key, or it failed). */
  verdict: SkillSafetyVerdict | null | undefined;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}) {
  const t = useTranslations("skills");
  const tone: Tone = verdict ? verdict.verdict : "unscanned";
  const Glyph = Icon[GLYPH[tone]];

  return (
    <div style={s.box(tone)}>
      <div style={s.head}>
        <Glyph size={15} style={{ color: TONE_COLOR[tone], flexShrink: 0 }} />
        <span style={s.title(tone)}>
          {verdict
            ? t(`import.safety.verdict.${verdict.verdict}`)
            : t("import.safety.unscanned.title")}
        </span>
        <span style={s.label}>{t("import.safety.title")}</span>
      </div>

      <span style={s.summary}>
        {verdict ? verdict.summary : t("import.safety.unscanned.body")}
      </span>

      {verdict && verdict.reasons.length > 0 && (
        <>
          <span style={s.reasonsTitle}>
            {t("import.safety.reasonsTitle", { count: verdict.reasons.length })}
          </span>
          {verdict.reasons.map((r, i) => (
            <div key={`${r.category}-${i}`} style={s.reason}>
              <q className="mono" style={s.quote}>
                {r.quote}
              </q>
              <span style={s.category}>{t(`import.safety.category.${r.category}`)}</span>
            </div>
          ))}
        </>
      )}

      {tone === "unsafe" && (
        <div style={s.gate}>
          <Checkbox
            checked={acknowledged}
            onChange={onAcknowledge}
            label={t("import.safety.unsafeGate")}
          />
        </div>
      )}
    </div>
  );
}
