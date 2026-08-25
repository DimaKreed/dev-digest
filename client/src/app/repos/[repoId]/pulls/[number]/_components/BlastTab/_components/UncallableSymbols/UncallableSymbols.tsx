/* Changed types and interfaces, in their own collapsed section.

   They cannot have callers: the index resolves invocations, and a type is
   annotated rather than invoked. Left in the tree they rendered "0 callers"
   exactly like a symbol that had genuinely been checked — 31 of 130 rows on one
   pull request, which is how the 13 real answers ended up buried. Setting them
   aside is not the same as dropping them, so they are still here, still counted,
   and still say which file declares each. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { UncallableSymbol } from "../../helpers";
import { s } from "../../styles";

export function UncallableSymbols({ items }: { items: UncallableSymbol[] }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);

  if (items.length === 0) return null;

  return (
    <section style={s.priorSection}>
      <button
        type="button"
        style={s.priorToggle}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Icon.Code size={13} />
        {t("uncallable.title")}
        <Badge mono>{items.length}</Badge>
        <Icon.ChevronRight
          size={13}
          style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : undefined }}
        />
      </button>

      {open && (
        <>
          <span style={s.empty}>{t("uncallable.body")}</span>
          <div style={s.uncallableList}>
            {items.map((sym) => (
              <div key={`${sym.name}#${sym.file}`} style={s.uncallableRow}>
                <span style={s.uncallableName}>{sym.name}</span>
                {sym.kind && <Badge mono>{sym.kind}</Badge>}
                <span style={s.uncallableFile}>{sym.file}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
