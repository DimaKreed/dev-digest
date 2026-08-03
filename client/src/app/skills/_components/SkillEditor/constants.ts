import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Skill editor tabs. There is deliberately no Evals tab: `eval_cases` /
 * `eval_runs` are empty course scaffolding, and a tab reading from them would
 * show invented numbers.
 */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);

export const DEFAULT_TAB = "config";
