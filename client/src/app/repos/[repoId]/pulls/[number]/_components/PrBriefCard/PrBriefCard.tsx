/* PrBriefCard — the generated merge-risk brief for one pull request: its own
   risk level, what the change does, why it is risky, the risks themselves, and
   the places worth reading first, each one activatable into the diff tab.

   Purely presentational. The page owns `usePrBrief` / `useGenerateBrief` and
   owns the URL, so activating a focus entry reports the ref UPWARD rather than
   navigating from here — `src/components/` and a card both stay ignorant of the
   page's query-string shape, and a reload or a shared link reopens the same
   target because the page put it in the URL (AC-29).

   What this card deliberately does NOT show (AC-26, Non-goals): a verdict, a
   findings count, a blocker count or a PR score. Those come from `agent_runs`
   and `VerdictBanner` already renders them on the Agent runs tab. The brief
   stands on its own on a pull request no agent has ever reviewed.

   Everything here is model output and therefore untrusted: it renders as text,
   never through `dangerouslySetInnerHTML`; a `risk_level` outside the
   contract's enum renders nothing rather than being echoed; and the paths were
   already checked against the assembled input server-side (AC-13) before they
   could become a deep link. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@devdigest/ui";
import type { BriefFileRef, PrBrief } from "@devdigest/shared";
import type { BriefAvailability } from "@/lib/hooks/brief";
import { s } from "./styles";
import { formatCost, isKnownRiskLevel, RISK_LEVEL_COLOR } from "./constants";

interface PrBriefCardProps {
  /** `null` when none has been generated for this pull request yet. */
  brief: PrBrief | null;
  /** Computed server-side (AC-16) — this card compares no sha and no model. */
  stale?: boolean;
  loading?: boolean;
  generating?: boolean;
  /** A human-readable reason the brief could not be loaded or generated. */
  error?: string | null;
  /**
   * Whether the server can pay for a generation, and why not (AC-24).
   *
   * Absent while the read is in flight, and on any response that predates the
   * field. Absence is treated as "offered": claiming a key is missing when the
   * server never said so would be the same dishonesty in the other direction.
   */
  availability?: BriefAvailability | null;
  onGenerate: () => void;
  onOpenFocus: (ref: BriefFileRef) => void;
}

/** `path` on its own when the model gave no line — never a fabricated one. */
function refLabel(ref: BriefFileRef): string {
  return typeof ref.line === "number" ? `${ref.path}:${ref.line}` : ref.path;
}

export function PrBriefCard({
  brief,
  stale,
  loading,
  generating,
  error,
  availability,
  onGenerate,
  onOpenFocus,
}: PrBriefCardProps) {
  const t = useTranslations("brief");

  // AC-24 — the generation route answers 503 with no provider key, so the card
  // says a key is required and offers no live control instead of letting the
  // reader press one and be shown the server's own sentence.
  const canGenerate = availability?.can_generate ?? true;

  /**
   * AC-42 — one polite live region, and the risk level lives INSIDE it.
   *
   * A generation completing replaces its content, which is exactly the outcome
   * worth announcing; a separate silent header plus a region that only ever
   * says "generating" would announce the wait and not the answer.
   */
  const level = brief && isKnownRiskLevel(brief.risk_level) ? brief.risk_level : null;
  const outcome = (
    <div role="status" aria-live="polite" style={s.head}>
      {generating && <span style={s.meta}>{t("card.generating")}</span>}
      {!generating && level && (
        <Badge
          icon="AlertTriangle"
          color={RISK_LEVEL_COLOR[level].color}
          bg={RISK_LEVEL_COLOR[level].bg}
        >
          {t(`card.riskLevel.${level}`)}
        </Badge>
      )}
      {!generating && brief && stale && (
        <Badge icon="AlertTriangle" color="var(--warn-text)" bg="var(--warn-bg)">
          {t("intentCard.stale")}
        </Badge>
      )}
    </div>
  );

  if (loading) {
    return (
      <section style={s.card}>
        {outcome}
        <div style={s.skeletons}>
          <Skeleton height={16} />
          <Skeleton height={44} />
        </div>
      </section>
    );
  }

  // AC-34 — an error state that names its reason and offers a retry, and is
  // distinguishable from the empty state: neither the empty title nor its CTA
  // is rendered here, so the two cannot be confused for one another.
  if (!brief && error) {
    return (
      <section style={s.card}>
        {outcome}
        <div style={s.block}>
          <span style={s.label}>{t("card.error.title")}</span>
          <p style={s.body}>{t("card.error.body", { reason: error })}</p>
        </div>
        <div style={s.footer}>
          {canGenerate ? (
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onGenerate}>
              {t("card.error.retry")}
            </Button>
          ) : (
            // Reachable: a failed REFETCH keeps the previous response's
            // availability, so a known-keyless install can land here. Retrying
            // could only produce the 503 of AC-24, so the retry is replaced by
            // the same requirement sentence the empty state uses rather than
            // offering a control whose one possible answer is a failure.
            <span style={s.meta}>{t("card.missingKey")}</span>
          )}
        </div>
      </section>
    );
  }

  // AC-32 — the in-progress state is its own branch with no control to press,
  // so a second generation cannot be started from this view at all. Not merely
  // a disabled button: there is nothing here to click.
  if (generating) {
    return (
      <section style={s.card}>
        {outcome}
        <div style={s.skeletons}>
          <Skeleton height={16} />
          <Skeleton height={44} />
        </div>
      </section>
    );
  }

  // AC-33 — the empty state: a title, a body saying what generation does, and
  // the call to action.
  if (!brief) {
    return (
      <section style={s.card}>
        {outcome}
        <div style={s.block}>
          <span style={s.label}>{t("card.empty.title")}</span>
          <p style={s.body}>{t("card.empty.body")}</p>
        </div>
        <div style={s.footer}>
          {canGenerate ? (
            <Button kind="primary" size="sm" icon="Sparkles" onClick={onGenerate}>
              {t("card.empty.cta")}
            </Button>
          ) : (
            // The call to action is REPLACED, not disabled: a greyed button
            // beside a sentence is still an invitation to click, and the whole
            // point of AC-24 is that a key-less install must not look broken.
            <span style={s.meta}>{t("card.missingKey")}</span>
          )}
        </div>
      </section>
    );
  }

  const cost = formatCost(brief.usage?.cost_usd);

  return (
    <section style={s.card}>
      {outcome}

      {/* AC-26 — the brief's own what and why, and nothing from a review. */}
      <div style={s.block}>
        <span style={s.label}>{t("card.what")}</span>
        <p style={s.body}>{brief.what}</p>
      </div>
      <div style={s.block}>
        <span style={s.label}>{t("card.why")}</span>
        <p style={s.body}>{brief.why}</p>
      </div>

      {/* AC-27 — the risks live here, in the brief card. `IntentCard` renders
          none and is not modified by this feature. */}
      <div style={s.block}>
        <span style={s.label}>{t("block.risks")}</span>
        {brief.risks.length > 0 ? (
          <div style={s.riskList}>
            {brief.risks.map((risk, i) => (
              <div key={`${risk.title}-${i}`} style={s.riskItem}>
                <div style={s.riskHead}>
                  <span style={s.riskTitle}>{risk.title}</span>
                  {/* The severity is the contract's own enum value, rendered as
                      data. It is deliberately not the risk-LEVEL label: the
                      level describes the whole change, a severity one risk. */}
                  <Badge mono>{risk.severity}</Badge>
                </div>
                <span style={s.riskText}>{risk.explanation}</span>
                {risk.refs.length > 0 && (
                  <div style={s.refs}>
                    {risk.refs.map((ref, j) => (
                      <span key={`${ref.path}-${j}`} className="mono">
                        {refLabel(ref)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // AC-35 — a statement, not a blank block. Zero risks is a real result.
          <span style={s.empty}>{t("noRisks")}</span>
        )}
      </div>

      {/* AC-28 — the review-focus entries, as activatable entries. */}
      <div style={s.block}>
        <span style={s.label}>{t("card.reviewFocus")}</span>
        {brief.review_focus.length > 0 ? (
          <div style={s.focusList}>
            {brief.review_focus.map((entry, i) => (
              <button
                key={`${entry.ref.path}-${entry.label}-${i}`}
                type="button"
                style={s.focusEntry}
                // AC-30 — an entry with no line is activated exactly like one
                // with a line; the ref is passed through untouched and the page
                // decides what a missing line means. Nothing here is inert.
                onClick={() => onOpenFocus(entry.ref)}
              >
                <span style={s.focusLabel}>{entry.label}</span>
                <span style={s.focusReason}>{entry.reason}</span>
                <span className="mono" style={s.meta}>
                  {refLabel(entry.ref)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span style={s.empty}>{t("card.noFocus")}</span>
        )}
      </div>

      {/* AC-37 — every source the brief could not fully read, by name and
          reason, plus the count of entries the grounding gate dropped. None of
          them is swallowed. */}
      {brief.degraded_sources.length > 0 && (
        <div style={s.warnRow}>
          <span style={s.label}>{t("card.degraded")}</span>
          <ul style={s.list}>
            {brief.degraded_sources.map((source, i) => (
              <li key={`${source.name}-${i}`}>
                {source.name} — {source.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {typeof brief.dropped_entries === "number" && brief.dropped_entries > 0 && (
        <span style={s.meta}>{t("card.dropped", { count: brief.dropped_entries })}</span>
      )}

      <div style={s.footer}>
        {/* AC-41 — icon-only, so its accessible name comes from `aria-label`.
            AC-36 — this is also the regenerate action a stale brief offers. */}
        {/* AC-24 — with no provider key the control stays present and named,
            so the reader can see the action exists, but it is unavailable and
            the sentence beside it says why. The stored brief is still shown in
            full: a missing key stops a REgeneration, not a read. */}
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          aria-label={t("card.regenerate")}
          disabled={!canGenerate}
          onClick={onGenerate}
        />
        {!canGenerate && <span style={s.meta}>{t("card.missingKey")}</span>}
        {stale && <span style={s.meta}>{t("intentCard.staleHint")}</span>}
        {brief.usage && (
          // AC-39 — the figures are passed as STRINGS: an ICU number placeholder
          // would group `1200` as `1,200`, and these are token counts, not money.
          <span style={s.meta}>
            {t("card.tokens", {
              tokensIn: String(brief.usage.tokens_in),
              tokensOut: String(brief.usage.tokens_out),
            })}
          </span>
        )}
        {/* An unpriced call reads as unpriced, never as costing zero. */}
        <span style={s.meta}>{cost ?? t("card.unpriced")}</span>
      </div>
    </section>
  );
}
