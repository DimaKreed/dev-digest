/* SectionCard — one section of the tour.

   Three things this card decides rather than the document:
     - the heading comes from the onboarding namespace keyed by `kind`; the
       model-supplied `title` is never displayed;
     - a diagram renders only on the one kind that has one, whatever other
       sections carry;
     - a file link points at the sha the tour was GENERATED at, so it resolves
       even after the file moves.

   `body` is model output. It renders through the shared Markdown primitive,
   which is react-markdown + GFM with no raw-HTML plugin, so embedded markup is
   shown as text rather than mounted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, IconBtn, Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { DIAGRAM_KIND } from "../../constants";
import { blobUrl } from "../../helpers";
import { s } from "./styles";

export function SectionCard({
  section,
  fullName,
  sha,
}: {
  section: OnboardingSection;
  fullName: string | null | undefined;
  sha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const title = t(`sectionTitles.${section.kind}`);
  const showDiagram = section.kind === DIAGRAM_KIND && !!section.diagram;

  return (
    <Card>
      <section aria-labelledby={`onboarding-${section.kind}`}>
        <div style={s.header}>
          <h2 id={`onboarding-${section.kind}`} style={s.heading}>
            {title}
          </h2>
          <div style={s.spacer}>
            <IconBtn
              icon={open ? "ChevronDown" : "ChevronRight"}
              label={open ? t("collapseSection", { section: title }) : t("expandSection", { section: title })}
              onClick={() => setOpen((v) => !v)}
            />
          </div>
        </div>

        {open && (
          <div style={s.body}>
            <Markdown>{section.body}</Markdown>

            {showDiagram && (
              <div style={s.diagram}>
                <MermaidDiagram chart={section.diagram ?? ""} />
              </div>
            )}

            {section.links.length > 0 && (
              <ul style={s.links}>
                {section.links.map((link) => {
                  const href = blobUrl(fullName, sha, link.path);
                  return (
                    <li key={link.path}>
                      {href ? (
                        <a
                          className="mono"
                          style={s.link}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("linkLabel", { path: link.path })}
                        >
                          {link.label}
                        </a>
                      ) : (
                        <span className="mono" style={s.deadLink}>
                          {link.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </Card>
  );
}
