import type { Provider } from '@devdigest/shared';

/**
 * Onboarding module constants. Pure values only — no I/O and no reach into the
 * persistence or adapter layers (arch rule `c5-pure-helpers` covers this file
 * as well as `helpers.ts`).
 */

/**
 * The five section kinds a tour is made of, in render order. This array IS the
 * order: the skeleton builder walks it, the prompt renders it, and the client
 * filters against it. A sixth kind is not a tour section — it is dropped.
 */
export const SECTION_KINDS = [
  'overview',
  'architecture',
  'key_modules',
  'getting_started',
  'conventions',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The one section a diagram is rendered for. Every other diagram is ignored. */
export const DIAGRAM_KIND: SectionKind = 'architecture';

/**
 * Timeout for the single generation call, well above the 90s provider default.
 *
 * Copied from the conventions extractor's measured number rather than inherited
 * from the provider: both are one large structured completion over a whole
 * repository, and OpenRouter routes each attempt to a different upstream, so
 * the slow draws are minutes rather than seconds. Abandoning one at 90s costs
 * the 90s AND buys another lottery ticket. Keep equal to `EXTRACTION_TIMEOUT_MS`
 * in `modules/conventions/constants.ts`.
 */
export const ONBOARDING_TIMEOUT_MS = 300_000;

/** The manifest the stack and the runnable scripts are read from. */
export const MANIFEST_PATH = 'package.json';

/** How many top-ranked files the reading path lists. */
export const READING_PATH_N = 8;

/** Ceiling on links kept per section, before verification drops any. */
export const MAX_LINKS_PER_SECTION = 4;

/** Token budget for the repo skeleton mixed into the generation prompt. */
export const REPO_MAP_TOKEN_BUDGET = 2000;

/** Cap on the endpoint and cron lists carried into the facts block. */
export const MAX_FACT_ITEMS = 40;

/** Cap on the repo skeleton block inside the facts payload. */
export const MAX_REPO_MAP_CHARS = 8_000;

/**
 * Which stored key a provider's availability is decided by.
 *
 * Restated here rather than imported from the settings slice: reaching into
 * another slice's folder trips the `no-cross-module` arch rule even for a bare
 * constant. Keep equal to the map of the same name under `modules/settings`.
 * Only key PRESENCE is ever read through this — no value reaches a response.
 */
export const SECRET_KEY_BY_PROVIDER: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
