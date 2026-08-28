import type { Onboarding, OnboardingSection } from "@devdigest/shared";
import { SECTION_KINDS, type SectionKind } from "./constants";

/**
 * The sections that may be rendered, in the fixed order.
 *
 * `OnboardingSection.kind` is a free string on the wire and the client performs
 * no runtime validation, so an unrecognised kind arrives silently. It is
 * dropped here rather than rendered with a missing title, and the order comes
 * from this list rather than from the document — a tour written by an older
 * server cannot reorder the page.
 */
export function visibleSections(tour: Onboarding | null | undefined): OnboardingSection[] {
  if (!tour) return [];
  const byKind = new Map<string, OnboardingSection>();
  for (const section of tour.sections) {
    if (!byKind.has(section.kind)) byKind.set(section.kind, section);
  }
  return SECTION_KINDS.map((kind) => byKind.get(kind)).filter(
    (s): s is OnboardingSection => s !== undefined,
  );
}

/** True when `kind` is one of the five the tour is made of. */
export function isSectionKind(kind: string): kind is SectionKind {
  return (SECTION_KINDS as readonly string[]).includes(kind);
}

/**
 * The blob URL for a cited file.
 *
 * Built from the repository's own stored owner/name and the sha the tour was
 * generated at — never the current head, so a file that has since moved still
 * resolves to the commit the tour described. Returns null when the tour carries
 * no sha, because a link to a moving target is worse than no link.
 */
export function blobUrl(
  fullName: string | null | undefined,
  sha: string | null | undefined,
  path: string,
): string | null {
  if (!fullName || !sha) return null;
  return `https://github.com/${fullName}/blob/${sha}/${path}`;
}

/** True when the tour describes a commit other than the repository's head. */
export function isStale(
  tourSha: string | null | undefined,
  currentSha: string | null | undefined,
): boolean {
  if (!tourSha || !currentSha) return false;
  return tourSha !== currentSha;
}

/** Compact relative time, e.g. "3h ago". Mirrors the PR list's phrasing. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
