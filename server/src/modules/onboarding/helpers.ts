import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { Onboarding, OnboardingLink, OnboardingSection } from '@devdigest/shared';
import {
  MAX_LINKS_PER_SECTION,
  MAX_REPO_MAP_CHARS,
  SECTION_KINDS,
  type SectionKind,
} from './constants.js';
import type { ManifestFacts, OnboardingFacts } from './ports.js';

/**
 * The onboarding kernel — the whole of the tour's shaping logic, as pure
 * functions.
 *
 * Every function here takes data and returns data. Nothing in this file reads a
 * clock, a random source, the environment, the network, the filesystem, the
 * database or a model; the service resolves all of that first and hands the
 * results in. That is what makes the fact-only tour of AC-11 the BASE CASE
 * rather than a failure branch: `buildSkeleton` never needed the model, so a
 * model that fails simply leaves the skeleton unchanged.
 */

// ---------------------------------------------------------------------------
// AC-04 — the manifest is the only source of the stack and the scripts.
// ---------------------------------------------------------------------------

/**
 * Read the dependency names and the runnable scripts out of a package manifest.
 *
 * Returns nothing that is not literally in the text: a manifest that is absent,
 * empty or unparseable yields two empty lists, and no stack entry or script is
 * ever inferred, defaulted or renamed. The text is DATA — it is parsed, never
 * evaluated, and nothing in it selects a code path here.
 */
export function parseManifest(text: string): ManifestFacts {
  const empty: ManifestFacts = { stack: [], scripts: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch {
    return empty;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return empty;
  const manifest = doc as Record<string, unknown>;

  const stack: string[] = [];
  for (const key of ['dependencies', 'devDependencies']) {
    const block = manifest[key];
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const name of Object.keys(block as Record<string, unknown>)) {
      if (!stack.includes(name)) stack.push(name);
    }
  }

  const scripts: ManifestFacts['scripts'] = [];
  const scriptBlock = manifest['scripts'];
  if (typeof scriptBlock === 'object' && scriptBlock !== null && !Array.isArray(scriptBlock)) {
    for (const [name, command] of Object.entries(scriptBlock as Record<string, unknown>)) {
      if (typeof command === 'string') scripts.push({ name, command });
    }
  }

  return { stack, scripts };
}

// ---------------------------------------------------------------------------
// AC-01 / AC-03 / AC-11 — the deterministic tour.
// ---------------------------------------------------------------------------

/** Facts are optional one by one, so an empty fact set still yields a tour. */
export type SkeletonFacts = Readonly<Partial<OnboardingFacts>>;

const bullet = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');

const code = (value: string): string => '`' + value + '`';

function overviewBody(facts: SkeletonFacts): string {
  const parts: string[] = [];
  if (facts.repoName) parts.push(`**Repository:** ${code(facts.repoName)}`);
  if (facts.defaultBranch) parts.push(`**Default branch:** ${code(facts.defaultBranch)}`);
  const stack = facts.manifest?.stack ?? [];
  if (stack.length > 0) {
    parts.push(`**Declared dependencies**\n${bullet(stack.slice(0, 20).map(code))}`);
  }
  return parts.join('\n\n');
}

function architectureBody(facts: SkeletonFacts): string {
  const parts: string[] = [];
  if (facts.repoMap) parts.push(`**Repository skeleton**\n\n${facts.repoMap}`);
  const chains = facts.criticalPaths ?? [];
  if (chains.length > 0) {
    parts.push(
      `**Dependency chains from the highest-ranked files**\n${bullet(
        chains.map((chain) => chain.map(code).join(' → ')),
      )}`,
    );
  }
  return parts.join('\n\n');
}

function keyModulesBody(facts: SkeletonFacts): string {
  const parts: string[] = [];
  const reading = facts.readingPath ?? [];
  if (reading.length > 0) {
    parts.push(`**Reading path, by import rank**\n${bullet(reading.map(code))}`);
  }
  const endpoints = facts.endpoints ?? [];
  const crons = facts.crons ?? [];
  // A capped walk produces an empty list that is NOT a measurement, so an
  // absent claim is stated as absent rather than rendered as "there are none".
  if (endpoints.length > 0) {
    parts.push(`**Endpoints reached from those files**\n${bullet(endpoints.map(code))}`);
  } else if (facts.factsTruncated) {
    parts.push('**Endpoints reached from those files:** not measured — the impact walk was capped.');
  }
  if (crons.length > 0) {
    parts.push(`**Scheduled jobs reached from those files**\n${bullet(crons.map(code))}`);
  } else if (facts.factsTruncated) {
    parts.push(
      '**Scheduled jobs reached from those files:** not measured — the impact walk was capped.',
    );
  }
  return parts.join('\n\n');
}

function gettingStartedBody(facts: SkeletonFacts): string {
  const scripts = facts.manifest?.scripts ?? [];
  if (scripts.length === 0) return '';
  return `**Scripts declared in the manifest**\n${bullet(
    scripts.map((s) => `${code(s.name)} — ${code(s.command)}`),
  )}`;
}

function conventionsBody(facts: SkeletonFacts): string {
  const reading = facts.readingPath ?? [];
  if (reading.length === 0) return '';
  return `The highest-ranked files are the ones a change is most likely to touch. Read them for the house style before writing new code:\n${bullet(
    reading.slice(0, 5).map(code),
  )}`;
}

const BODY_BUILDERS: Record<SectionKind, (facts: SkeletonFacts) => string> = {
  overview: overviewBody,
  architecture: architectureBody,
  key_modules: keyModulesBody,
  getting_started: gettingStartedBody,
  conventions: conventionsBody,
};

/** Fact-derived links for a section: real indexed paths, never invented ones. */
function skeletonLinks(kind: SectionKind, facts: SkeletonFacts): OnboardingLink[] {
  if (kind !== 'key_modules' && kind !== 'conventions') return [];
  return (facts.readingPath ?? [])
    .slice(0, MAX_LINKS_PER_SECTION)
    .map((path) => ({ label: path, path }));
}

/**
 * The five sections of AC-01, in order, from the facts alone.
 *
 * This is the whole tour when no model is involved — a section whose facts are
 * missing gets an empty body, not a fabricated one, and the section itself is
 * still present so the shape of the tour never varies.
 */
export function buildSkeleton(facts: SkeletonFacts): OnboardingSection[] {
  return SECTION_KINDS.map((kind) => ({
    kind,
    // The display title comes from the client's own message catalogue keyed by
    // `kind`, so this value is never shown. It states the key rather than
    // inventing prose in a language the reader may not have chosen.
    title: kind,
    body: BODY_BUILDERS[kind](facts),
    diagram: null,
    links: skeletonLinks(kind, facts),
  }));
}

// ---------------------------------------------------------------------------
// AC-28 — everything read out of the repository goes to the model as data.
// ---------------------------------------------------------------------------

/**
 * Assemble the single user message from the facts, all of it inside one
 * untrusted block.
 *
 * Repository content — the manifest's own strings, file paths, the rendered
 * skeleton — is content to describe and never an instruction to follow. The
 * wrapper escapes any attempt to close it from inside, so a manifest whose
 * package name is a jailbreak attempt is still just a string in a list.
 */
export function buildFactsPayload(facts: SkeletonFacts): string {
  const parts: string[] = [];
  const repoMap = facts.repoMap ?? '';
  if (repoMap.trim()) {
    const clamped =
      repoMap.length <= MAX_REPO_MAP_CHARS
        ? repoMap
        : `${repoMap.slice(0, MAX_REPO_MAP_CHARS)}\n… (truncated)`;
    parts.push(`## REPO SKELETON\n\n${clamped}`);
  }
  for (const kind of SECTION_KINDS) {
    const body = BODY_BUILDERS[kind](facts);
    if (body.trim()) parts.push(`## FACTS FOR SECTION ${kind}\n\n${body}`);
  }
  return wrapUntrusted('repo-facts', parts.join('\n\n'));
}

// ---------------------------------------------------------------------------
// The model enriches; it never adds.
// ---------------------------------------------------------------------------

/** Just the fields a model section may contribute. */
export interface ModelSection {
  kind: string;
  body: string;
  diagram?: string | null;
  links?: ReadonlyArray<{ label: string; path: string }>;
}

/**
 * Fold model output into the skeleton.
 *
 * The skeleton decides which sections exist, and in what order; a model section
 * is matched by `kind` and may only enrich the one it matches. A `kind` with no
 * skeleton counterpart is dropped whole, so the five sections of AC-01 are
 * invariant no matter what comes back.
 */
export function mergeModelSections(
  skeleton: readonly OnboardingSection[],
  modelSections: readonly ModelSection[],
): OnboardingSection[] {
  const byKind = new Map<string, ModelSection>();
  for (const section of modelSections) {
    if (!byKind.has(section.kind)) byKind.set(section.kind, section);
  }

  return skeleton.map((section) => {
    const model = byKind.get(section.kind);
    if (!model) return section;

    // Fact-derived links come first and are kept; the model's own citations are
    // appended, de-duplicated by path, and capped. Every one of them is still
    // unverified at this point — `verifyLinks` is what decides they survive.
    const links: OnboardingLink[] = [...section.links];
    const seen = new Set(links.map((l) => l.path));
    for (const link of model.links ?? []) {
      if (links.length >= MAX_LINKS_PER_SECTION) break;
      if (seen.has(link.path)) continue;
      seen.add(link.path);
      links.push({ label: link.label, path: link.path });
    }

    const body = model.body.trim();
    return {
      kind: section.kind,
      title: section.title,
      body: body === '' ? section.body : body,
      diagram: model.diagram ?? section.diagram,
      links,
    };
  });
}

// ---------------------------------------------------------------------------
// AC-05 / AC-06 — a cited path survives only if the index has it.
// ---------------------------------------------------------------------------

/**
 * Drop every link whose path is absent from the indexed file set, and count the
 * drops.
 *
 * The indexed set only ever holds the file kinds the indexer supports, so a
 * link to a document outside that set drops even though the file exists in the
 * repository. That is deliberate: the count is returned so the loss is stated
 * rather than silently absorbed, and widening the set to reduce it would change
 * what "verified" means.
 */
export function verifyLinks(
  sections: readonly OnboardingSection[],
  indexed: ReadonlySet<string>,
): { sections: OnboardingSection[]; droppedLinks: number } {
  let droppedLinks = 0;
  const kept = sections.map((section) => {
    const links = section.links.filter((link) => {
      if (indexed.has(link.path)) return true;
      droppedLinks += 1;
      return false;
    });
    return { ...section, links };
  });
  return { sections: kept, droppedLinks };
}

/** Assemble the persisted document. Pure: every value is decided by the caller. */
export function buildTour(input: {
  sections: OnboardingSection[];
  sha: string | null;
  droppedLinks: number;
  generatedWithoutModel: boolean;
  hotnessAvailable: boolean;
}): Onboarding {
  return {
    sections: input.sections,
    sha: input.sha,
    dropped_links: input.droppedLinks,
    generated_without_model: input.generatedWithoutModel,
    hotness_available: input.hotnessAvailable,
  };
}
