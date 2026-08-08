/* IntentCard — what the system understood the PR to be trying to do, before it
   reviewed the code: the derived intent, its in/out-of-scope lists, how
   confident the classifier was, what context it could not reach, and the
   findings that were deferred because they fall outside the stated scope.

   Mounted at the top of BOTH the Overview and the Agent-runs tab; one
   `usePrIntent` hook backs both and TanStack Query dedupes the fetch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Chip,
  Icon,
  PercentProgress,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { FindingRecord, PrIntentDetail } from "@devdigest/shared";
import { s } from "./styles";

interface IntentCardProps {
  intent: PrIntentDetail | undefined;
  loading?: boolean;
  /** Findings the reviewer marked out of scope (decision G — always visible). */
  deferred?: FindingRecord[];
  onRederive: () => void;
  rederiving?: boolean;
}

function ScopeList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div style={s.scopeBox}>
      <span style={s.scopeTitle}>{title}</span>
      {items.length > 0 ? (
        <ul style={s.list}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <span style={s.empty}>{empty}</span>
      )}
    </div>
  );
}

export function IntentCard({
  intent,
  loading,
  deferred = [],
  onRederive,
  rederiving,
}: IntentCardProps) {
  const t = useTranslations("brief");
  const [showDeferred, setShowDeferred] = React.useState(false);

  const status = intent?.status ?? "absent";
  // A row with no text yet is not something to render as content, whatever the
  // status says — `deriving` and `absent` both arrive with empty scope lists.
  const hasContent = !!intent && intent.intent.length > 0;

  const header = (
    <div style={s.head}>
      <Chip>{t("block.intent")}</Chip>
      {intent?.stale && hasContent && (
        <Badge icon="AlertTriangle" color="var(--warn-text)" bg="var(--warn-bg)">
          {t("intentCard.stale")}
        </Badge>
      )}
      {hasContent && intent.sources && intent.sources.length > 0 && (
        <Badge icon="Copy" mono>
          {t("intentCard.sources", { count: intent.sources.length })}
        </Badge>
      )}
      {hasContent && typeof intent.confidence === "number" && (
        <div style={s.confidence}>
          <PercentProgress
            value={intent.confidence * 100}
            label={t("intentCard.confidence")}
          />
        </div>
      )}
    </div>
  );

  if (loading || (status === "deriving" && !hasContent)) {
    return (
      <section style={s.card}>
        {header}
        <div style={s.skeletons}>
          <Skeleton height={16} />
          <Skeleton height={44} />
        </div>
        <span style={s.meta}>{t("intentCard.deriving")}</span>
      </section>
    );
  }

  if (!hasContent) {
    return (
      <section style={s.card}>
        {header}
        <span style={s.intent}>{t("unavailable")}</span>
        <span style={s.meta}>{t("unavailableHint")}</span>
        <div style={s.footer}>
          <Button kind="secondary" size="sm" icon="Sparkles" onClick={onRederive} disabled={rederiving}>
            {rederiving ? t("intentCard.rederiving") : t("intentCard.rederive")}
          </Button>
          <span style={s.meta}>{t("intentCard.cost")}</span>
        </div>
      </section>
    );
  }

  return (
    <section style={s.card}>
      {header}
      <p style={s.intent}>{intent.intent}</p>

      <div style={s.scopeGrid}>
        <ScopeList
          title={t("intentCard.inScope")}
          items={intent.in_scope}
          empty={t("intentCard.noneStated")}
        />
        <ScopeList
          title={t("intentCard.outOfScope")}
          items={intent.out_of_scope}
          empty={t("intentCard.noneStated")}
        />
      </div>

      {intent.missing_context && intent.missing_context.length > 0 && (
        <div style={s.warnRow}>
          <span style={s.scopeTitle}>{t("intentCard.missingContext")}</span>
          <ul style={s.list}>
            {intent.missing_context.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {deferred.length > 0 && (
        <div>
          <button
            type="button"
            style={s.deferredToggle}
            onClick={() => setShowDeferred((open) => !open)}
            aria-expanded={showDeferred}
          >
            {showDeferred ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
            {t("intentCard.deferred", { count: deferred.length })}
          </button>
          {showDeferred && (
            <div style={s.deferredBody}>
              <span style={s.meta}>{t("intentCard.deferredHint")}</span>
              {deferred.map((f) => (
                <div key={f.id} style={s.deferredItem}>
                  <span style={s.deferredTitle}>
                    {f.severity} · {f.title}
                  </span>
                  <span className="mono">
                    {f.file}:{f.start_line}
                  </span>
                  {f.scope_rationale && <span>{f.scope_rationale}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={s.footer}>
        <Button
          kind="secondary"
          size="sm"
          icon="Sparkles"
          onClick={onRederive}
          disabled={rederiving || status === "deriving"}
        >
          {rederiving || status === "deriving"
            ? t("intentCard.rederiving")
            : t("intentCard.rederive")}
        </Button>
        {intent.stale && <span style={s.meta}>{t("intentCard.staleHint")}</span>}
        {intent.model && <span style={s.meta}>{t("intentCard.model", { model: intent.model })}</span>}
      </div>
    </section>
  );
}

/** The section label the card sits under on a tab. Kept beside the card so both
 *  mounts render it identically. */
export function IntentSectionLabel() {
  const t = useTranslations("brief");
  return <SectionLabel icon="Sparkles">{t("block.intent")}</SectionLabel>;
}
