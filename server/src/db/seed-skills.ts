import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Demo skills for the seed.
 *
 * A skill is a reusable block of instructions that several agents can share,
 * kept out of any single agent's system prompt. It is TEXT and nothing else —
 * no tools, no execution, no file access. The review engine renders the linked
 * bodies into the prompt's `## Skills / rules` section, in `agent_skills.order`.
 *
 * Keep each body short and directive. A skill competes for the same context
 * budget as the diff, and its token cost is shown in the editor.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  enabled: boolean;
  body: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description:
      'Evaluate overall PR quality across correctness, security, tests and scope. Apply to every review.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: `# PR Quality Rubric

Evaluate the pull request against the following dimensions. For each, return a
finding only when the issue is **worth the author's time** — aim for 5 high-signal
findings, not 50.

## Correctness
- Does the change do what the PR description claims?
- Are edge cases (empty input, nulls, concurrency) handled?

## Security
- Any secrets, tokens, or credentials in the diff?
- Untrusted input reaching a sink (SQL, shell, fetch)?

## Tests
- Are new branches covered by assertions?
- Are tests meaningful (not just snapshot churn)?

## Scope
- Does the diff stay within the stated intent?
- Flag out-of-scope changes separately rather than blocking.`,
  },
  {
    name: 'no-then-chains',
    description:
      'House rule: use async/await instead of .then() chains. Apply when reviewing asynchronous JavaScript or TypeScript.',
    type: 'convention',
    source: 'extracted',
    enabled: true,
    body: `# No .then() chains

This codebase uses \`async\`/\`await\` everywhere. A \`.then()\` chain in new code is a
convention violation — report it as a SUGGESTION, or a WARNING when the chain
also drops errors.

Flag:
- \`.then()\` / \`.catch()\` chains in code the diff adds or edits.
- A promise passed to \`forEach\`, which never awaits.
- A floating promise with no \`await\` and no \`.catch()\`.

Do not flag \`.then()\` inside code the diff merely moves, and never flag it in
test files where a rejection assertion reads more clearly as \`.rejects\`.`,
  },
  {
    name: 'secret-leakage-gate',
    description:
      'Detect committed credentials. Apply whenever the diff touches config, environment handling, or client-side bundles.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# Secret leakage gate

Treat any committed credential as CRITICAL — it is compromised the moment it is
pushed, and rotating it is the only fix.

Flag literal values matching:
- \`sk_live_\`, \`sk_test_\`, \`rk_live_\` (Stripe)
- \`AKIA\` + 16 uppercase alphanumerics (AWS access key id)
- \`ghp_\`, \`gho_\`, \`ghs_\`, \`github_pat_\` (GitHub tokens)
- \`-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\`
- Any \`NEXT_PUBLIC_*\` or \`VITE_*\` variable holding something that looks like a
  secret — those are inlined into the client bundle and are public by definition.

For each: state the exact file and line, and say the key must be **rotated**, not
merely removed, because it is already in git history.

Do NOT flag obvious placeholders (\`sk_live_xxx\`, \`<your-key-here>\`, \`REDACTED\`)
or values read from \`process.env\`.`,
  },
  {
    name: 'lethal-trifecta',
    description:
      'Flag changes combining private data access, untrusted input, and external communication. Apply to agent, webhook, and integration code.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# Lethal trifecta

A change is high risk when ONE code path combines all three of:

1. **Private data access** — reads secrets, user records, internal APIs, or the
   filesystem.
2. **Untrusted input** — processes content the attacker controls: PR bodies, issue
   text, webhook payloads, fetched pages, model output.
3. **External communication** — can send data out: HTTP client, email, webhook,
   logging to a third party, writing to a shared location.

Any two are normal. All three in one path means untrusted input can steer private
data outward — report it as CRITICAL and name each of the three legs with its
file and line.

When you report a trifecta finding, set \`kind\` to "trifecta" and list which of
\`private_data\`, \`untrusted_input\`, \`external_comms\` you identified in
\`trifecta_components\`.`,
  },
  {
    name: 'phantom-api-gate',
    description:
      'Detect calls to functions, modules, or endpoints that do not exist. Apply when the diff changes a public signature or adds an import.',
    type: 'security',
    source: 'imported_file',
    // Imported skills arrive DISABLED. Someone else's skill is someone else's
    // instructions in your agent's prompt — enabling it is a deliberate act
    // taken after reading the body.
    enabled: false,
    body: `# Phantom API gate

Flag any reference to something that does not exist, and any change that breaks
something that does.

## Hallucinated references
- An import of a module or named export not present in the repo or in
  \`package.json\`.
- A call to a method that the imported type does not declare.
- An HTTP call to a route with no matching handler.

## Breaking signature changes
Report as CRITICAL when the diff changes an exported function's or route's
contract and existing callers are not updated in the same diff:
- A parameter added without a default, removed, reordered, or retyped.
- A response field removed or renamed; a status code changed.
- A return type narrowed, or made nullable.

State the old and the new shape, and name at least one caller that still uses the
old one. If the diff updates every caller, do not report it.`,
  },
  {
    name: 'test-coverage-nudge',
    description:
      'Require assertions for every new branch and boundary. Apply when the diff adds tests or changes conditional logic.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: `# Test coverage nudge

For every conditional the diff adds or changes, look for the assertion that would
fail if that branch broke. When you cannot find one, report it — and name the
branch and the input that reaches it.

Always check for:
- The **negative** path of each new \`if\` / guard clause / early return.
- The \`catch\` block: does any test make the operation actually fail?
- Boundaries: empty collection, zero, negative, \`null\`/\`undefined\`, single item,
  and the value exactly at a limit.

A test that only covers the happy path of new branching logic is a WARNING, not a
SUGGESTION — that is precisely where defects survive review.

Never write "add more tests" or "coverage is low". Name the case.`,
  },
];

/**
 * Skills linked to each seeded agent, in prompt order.
 *
 * "Security Reviewer (control)" is deliberately ABSENT. Skills are rendered
 * into the prompt as their own section, independent of `systemPrompt`
 * (`reviewer-core/src/prompt.ts`), so a skill survives blanking the system
 * prompt — `secret-leakage-gate` would keep telling the ablated agent to hunt
 * for secrets and quietly hold recall up. The control agent has to carry
 * exactly one variable, so it carries none.
 */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'Test Quality Reviewer': ['test-coverage-nudge', 'pr-quality-rubric'],
  'Security Reviewer': ['secret-leakage-gate', 'lethal-trifecta'],
};
