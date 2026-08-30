#!/usr/bin/env node
/**
 * verify:l06 — the acceptance gate for SPEC-04, the Eval Pipeline.
 *
 * Checks the criteria that a passing unit test alone cannot: that the scorer
 * reaches no model, that the wiring is registered, and that both packages
 * still typecheck — plus it runs the suites that own the rest.
 *
 * Deliberately NOT a wrapper around `pnpm test`: the point of a lesson gate is
 * to name the criterion it is enforcing when it fails, so the reader knows what
 * broke rather than which file did.
 *
 * Run from the repository root, or via `pnpm verify:l06` in `server/`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const isWin = process.platform === 'win32';

let failures = 0;
const results = [];

function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  if (!ok) failures++;
  const mark = ok ? '[32m✓[0m' : '[31m✗[0m';
  process.stdout.write(`${mark} ${name}${detail ? `\n    ${detail}` : ''}\n`);
}

function check(name, fn) {
  try {
    const problem = fn();
    record(problem == null, name, problem ?? '');
  } catch (e) {
    record(false, name, e instanceof Error ? e.message : String(e));
  }
}

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function run(cwd, cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: join(ROOT, cwd),
    encoding: 'utf8',
    shell: isWin,
    stdio: 'pipe',
  });
  return {
    ok: res.status === 0,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  };
}

function runCheck(name, cwd, cmd, args) {
  process.stdout.write(`… ${name}\n`);
  const { ok, out } = run(cwd, cmd, args);
  record(ok, name, ok ? '' : out.split('\n').slice(-25).join('\n    '));
}

console.log('\nverify:l06 — Eval Pipeline (SPEC-04)\n');

// --- AC-06: scoring makes no LLM call ---------------------------------------
// A static check, because a test can only prove that the model was not called
// on the paths the test took. This proves the module cannot call one at all.
check('AC-06 · the scorer imports no provider, container or database', () => {
  const src = read('server/src/modules/eval/scoring.ts');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const allowed = new Set(['@devdigest/shared']);
  const bad = imports.filter((i) => !allowed.has(i));
  if (bad.length > 0) return `scoring.ts imports ${bad.join(', ')}; only @devdigest/shared is allowed`;
  if (/llm|complete|provider|openai|anthropic/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')))
    return 'scoring.ts mentions a model provider outside its comments';
  return null;
});

check('AC-06 · the eval service makes exactly one engine call per case', () => {
  const src = read('server/src/modules/eval/service.ts');
  const calls = (src.match(/reviewPullRequest\(/g) ?? []).length;
  if (calls !== 1) return `expected 1 reviewPullRequest call site, found ${calls}`;
  return null;
});

// --- wiring ------------------------------------------------------------------
check('the eval module is registered in the module registry', () => {
  const src = read('server/src/modules/index.ts');
  if (!src.includes("from './eval/routes.js'")) return 'modules/index.ts does not import ./eval/routes.js';
  if (!/\bevals,/.test(src)) return 'modules/index.ts does not register the module in `modules`';
  return null;
});

check('every eval route the UI calls is declared', () => {
  const src = read('server/src/modules/eval/routes.ts');
  const required = [
    "'/eval/dashboard'",
    "'/eval/batches/:id'",
    "'/agents/:id/eval-cases'",
    "'/eval-cases/:id'",
    "'/eval-cases/:id/run'",
    "'/eval-cases/:id/runs'",
    "'/findings/:id/eval-case'",
    "'/findings/:id/eval-case/draft'",
    "'/agents/:id/eval-preview'",
    "'/agents/:id/eval-runs'",
    "'/agents/:id/eval-dashboard'",
  ];
  const missing = required.filter((r) => !src.includes(r));
  return missing.length > 0 ? `missing routes: ${missing.join(', ')}` : null;
});

check('the schema carries the columns a comparable run needs', () => {
  const src = read('server/src/db/schema/eval.ts');
  const required = [
    'expectation_kind',
    'source_finding_id',
    'batch_id',
    'agent_version',
    'system_prompt',
    'counts',
    'error',
  ];
  const missing = required.filter((c) => !src.includes(`'${c}'`));
  return missing.length > 0 ? `missing columns: ${missing.join(', ')}` : null;
});

check('a migration exists for those columns', () => {
  const journal = JSON.parse(read('server/src/db/migrations/meta/_journal.json'));
  const tags = journal.entries.map((e) => e.tag);
  const hit = tags.find((tag) => {
    const sql = readFileSync(join(ROOT, 'server/src/db/migrations', `${tag}.sql`), 'utf8');
    return sql.includes('expectation_kind') && sql.includes('batch_id');
  });
  return hit ? null : 'no migration adds expectation_kind and batch_id';
});

check('the Eval Dashboard is reachable from the sidebar (AC-11)', () => {
  const nav = read('client/src/vendor/ui/nav.ts');
  if (!nav.includes('href: "/eval"')) return 'nav.ts has no /eval entry';
  const page = join(ROOT, 'client/src/app/eval/page.tsx');
  if (!existsSync(page)) return 'client/src/app/eval/page.tsx does not exist';
  const agentPage = join(ROOT, 'client/src/app/eval/[agentId]/page.tsx');
  if (!existsSync(agentPage)) return 'client/src/app/eval/[agentId]/page.tsx does not exist';
  return null;
});

check('a finding can be turned into an eval case in one click (AC-01)', () => {
  const card = read(
    'client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx',
  );
  if (!card.includes('onTurnIntoEvalCase')) return 'FindingCard has no eval-case action';
  const panel = read(
    'client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx',
  );
  if (!panel.includes('onTurnIntoEvalCase')) return 'FindingsPanel does not wire the action';
  return null;
});

check('AC-18 · a case can be RUN before it is created, and the draft writes nothing', () => {
  // The click used to create the case outright. A case whose expected line
  // misses its own diff hunk is dropped by the grounding gate on every run and
  // can never pass, and the only way to catch that is to run it first.
  const svc = read('server/src/modules/eval/service.ts');
  if (!/async draftFromFinding\(/.test(svc)) return 'service.ts has no draftFromFinding';
  if (!/async previewCase\(/.test(svc)) return 'service.ts has no previewCase';
  // The preview path must not touch the repository at all.
  const body = svc.slice(svc.indexOf('async previewCase('), svc.indexOf('async seedFromFinding('));
  if (/this\.deps\.repo\./.test(body))
    return 'previewCase touches the repository; a dry run must persist nothing';

  const panel = read(
    'client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx',
  );
  if (/useEvalCaseFromFinding/.test(panel))
    return 'the finding button still creates a case outright instead of opening the editor';
  if (!/EvalCaseDialog/.test(panel)) return 'FindingsPanel does not open the eval-case editor';
  return null;
});

check('a run persists what it MISSED and what it VIOLATED, not just counts', () => {
  // The expected-vs-actual view renders the scorer's own verdict rather than
  // re-matching in the browser, so the two can never disagree. That only holds
  // while the service actually persists it.
  const src = read('server/src/modules/eval/service.ts');
  if (!/missed: scored\.missed/.test(src) || !/violations: scored\.violations/.test(src))
    return 'service.ts does not persist scored.missed / scored.violations';
  const view = 'client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/ExpectedVsActual.tsx';
  if (!existsSync(join(ROOT, view))) return 'the expected-vs-actual view does not exist';
  // Comments are stripped first: the view LEGITIMATELY explains the rule in
  // prose, and a check that cannot tell prose from code teaches people to work
  // around it rather than to obey it.
  const ui = read(view)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/locationsMatch|start_line\s*<=|Math\.(min|max)\(/.test(ui))
    return 'the match rule looks re-implemented in the client; it belongs only in scoring.ts';
  return null;
});

check('the Evals tab is mounted in the Agent Editor', () => {
  const editor = read('client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx');
  if (!editor.includes('EvalsTab')) return 'AgentEditor does not render EvalsTab';
  const constants = read('client/src/app/agents/[id]/_components/AgentEditor/constants.ts');
  if (!constants.includes('"evals"')) return 'the evals tab is not in TABS';
  return null;
});

// --- AC-14: the seeded set ---------------------------------------------------
check('AC-14 · the seeded set has at least 8 cases, in both polarities', () => {
  const src = read('server/src/db/seed-evals.ts');
  const count = (src.match(/expectationKind: '/g) ?? []).length;
  if (count < 8) return `found ${count} seeded cases, need at least 8`;
  if (!src.includes("expectationKind: 'must_find'")) return 'no must_find case is seeded';
  if (!src.includes("expectationKind: 'must_not_flag'")) return 'no must_not_flag case is seeded';
  return null;
});

check('the spec is approved, not a draft', () => {
  const spec = read('specs/04-eval-pipeline.md');
  return /^Status: approved$/m.test(spec) ? null : 'specs/04-eval-pipeline.md is not approved';
});

// --- suites -------------------------------------------------------------------
runCheck('server · typecheck', 'server', 'pnpm', ['typecheck']);
runCheck('server · arch boundaries', 'server', 'pnpm', ['arch']);
runCheck('server · eval unit tests', 'server', 'pnpm', [
  'exec',
  'vitest',
  'run',
  'test/eval-scoring.test.ts',
  'test/eval-seed-cases.test.ts',
  'test/eval-service.test.ts',
]);
runCheck('client · typecheck', 'client', 'pnpm', ['typecheck']);
runCheck('client · full suite', 'client', 'pnpm', ['test']);

console.log('');
if (failures > 0) {
  console.error(`[31mverify:l06 FAILED[0m — ${failures} of ${results.length} checks`);
  process.exit(1);
}
console.log(`[32mverify:l06 PASSED[0m — ${results.length} checks`);
