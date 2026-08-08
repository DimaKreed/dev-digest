#!/usr/bin/env node
/**
 * Validate the YAML frontmatter of every agent under .claude/agents/.
 *
 * The agent registry is read at session start, so a *correct* new file and a
 * broken one both fail with `Agent type '<name>' not found`. This check is the
 * only thing that separates them — run it out of band before believing that
 * error.
 *
 *   node scripts/check-agent-frontmatter.mjs
 *
 * One PASS/FAIL line per agent, non-zero exit on any failure. Paths resolve
 * from this file rather than the cwd, so it runs from the repo root, from
 * server/, or from anywhere else.
 *
 * Uses the `yaml` copy `pnpm install` already put in server/node_modules
 * (the same trick make-skill-sample.mjs uses for fflate) rather than a global
 * dependency: a repo script may assume only node, git and POSIX builtins.
 *
 * The reasoning behind each assertion lives in .claude/agents/README.md
 * § Authoring a new agent; .claude/skills/pr-self-review/invariants.md makes
 * this check blocking as `agent-frontmatter-invalid`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = join(root, '.claude', 'agents');
const skillsDir = join(root, '.claude', 'skills');

const KNOWN = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'PowerShell',
  'Skill',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
  'Agent',
];
const MODELS = ['opus', 'sonnet', 'haiku', 'inherit'];
const READONLY = [
  'architecture-reviewer',
  'plan-verifier',
  'security-reviewer',
  'insight-curator',
];
const NOSKILLS = ['plan-verifier'];
const SKILL_ONLY = ['allowed-tools', 'disable-model-invocation'];

// Advisory only — never affects the exit code. `skills:` preloads whole
// SKILL.md bodies into the subagent's context before it has read anything.
const PRELOAD_BUDGET = 25 * 1024;

const { parse } = await import(
  pathToFileURL(join(root, 'server', 'node_modules', 'yaml', 'dist', 'index.js')).href
).catch(() => {
  console.error('yaml not found — run `pnpm install` in server/ first.');
  process.exit(1);
});

/** Byte total of the SKILL.md bodies this agent preloads, as a line suffix. */
function preloadNote(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';
  let bytes = 0;
  for (const s of skills) {
    const p = join(skillsDir, String(s), 'SKILL.md');
    if (existsSync(p)) bytes += statSync(p).size;
  }
  const over = bytes > PRELOAD_BUDGET ? ` (over the ${PRELOAD_BUDGET / 1024} KB budget)` : '';
  return ` · preload ${(bytes / 1024).toFixed(1)} KB${over}`;
}

let bad = 0;
for (const f of readdirSync(agentsDir).filter((n) => n.endsWith('.md') && n !== 'README.md')) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(agentsDir, f), 'utf8'));
  const e = [];
  let d = {};
  if (!m) {
    e.push('no frontmatter');
  } else {
    try {
      d = parse(m[1]) || {};
    } catch (x) {
      e.push('yaml: ' + x.message);
    }
  }
  const stem = f.slice(0, -3);
  const t = typeof d.tools === 'string' ? d.tools.split(',').map((s) => s.trim()) : null;

  if (d.name !== stem) e.push('name != file stem');
  if (typeof d.description !== 'string' || d.description.length <= 120)
    e.push('description missing or truncated');
  if (!t) e.push('tools is not a comma-separated string');
  if ('skills' in d && !Array.isArray(d.skills)) e.push('skills is not a block sequence');
  if (NOSKILLS.includes(stem) && 'skills' in d) e.push('skills must be omitted entirely, not empty');
  for (const s of d.skills || [])
    if (!existsSync(join(skillsDir, String(s), 'SKILL.md'))) e.push(`no SKILL.md for ${s}`);
  for (const k of SKILL_ONLY) if (k in d) e.push(`${k} is Skill-only`);
  for (const x of t || []) if (!KNOWN.includes(x)) e.push(`unknown tool ${x}`);
  if (READONLY.includes(stem))
    for (const x of ['Write', 'Edit']) if ((t || []).includes(x)) e.push(`${x} must stay withheld`);
  if ('model' in d && !MODELS.includes(d.model)) e.push(`model ${d.model}`);

  const head = (e.length ? 'FAIL ' : 'PASS ') + f + preloadNote(d.skills);
  console.log(head + (e.length ? ' — ' + e.join('; ') : ''));
  bad += e.length ? 1 : 0;
}
process.exit(bad ? 1 : 0);
