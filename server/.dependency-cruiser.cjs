/**
 * Onion-architecture boundary check. NOT a linter — this repo deliberately has no
 * ESLint/Biome/Prettier (root CLAUDE.md). This file only validates *import direction*
 * between rings, and adds no dependency: `dependency-cruiser` is already a runtime
 * dependency here (adapters/depgraph uses it as a library).
 *
 * Rule ids mirror .claude/skills/onion-architecture/SKILL.md one-to-one. Changing a
 * rule here means changing the rule there.
 *
 * Run: pnpm arch
 */
module.exports = {
  forbidden: [
    {
      name: 'c1-routes-no-persistence',
      comment:
        'C1 — a route handler is transport: resolve context, call one service method, return. ' +
        'Importing drizzle-orm or db/schema means the handler owns SQL.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^(src/db/|node_modules/drizzle-orm)' },
    },
    {
      name: 'c2-db-only-in-repository',
      comment:
        'C2 — only modules/<domain>/repository.ts (or repository/*.repo.ts) may touch db/schema. ' +
        'One repository owns a table.',
      severity: 'error',
      from: {
        path: '^src/modules/',
        pathNot: '(/repository\\.ts|/repository/[^/]+\\.repo\\.ts)$',
      },
      to: { path: '^src/db/schema' },
    },
    {
      name: 'c4-sdks-only-in-adapters',
      comment:
        'C4 — every external SDK call lives behind a port in src/adapters/. ' +
        'Never import octokit / openai / @anthropic-ai / simple-git / postgres / @ast-grep from a module.',
      severity: 'error',
      from: { path: '^src/(modules|platform)/' },
      to: {
        path: '^node_modules/(octokit|openai|@octokit|@anthropic-ai|simple-git|postgres|@ast-grep|@vscode/ripgrep)',
      },
    },
    {
      name: 'c5-pure-helpers',
      comment:
        'C5 — helpers.ts / constants.ts / status.ts are ring 0: pure functions, no I/O. ' +
        'No db, no adapters. Take data in, return data out.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/(helpers|constants|status)\\.ts$' },
      to: { path: '^src/(db|adapters)/' },
    },
    {
      name: 'c6-adapters-not-to-modules',
      comment:
        'C6 — infrastructure may not depend on a feature slice. Move the shared constant ' +
        'inward (to the adapter or to vendor/shared) instead.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'c6-adapters-not-to-db',
      comment:
        'C6 — an adapter must not query the database directly; it goes through a repository ' +
        'or receives the data it needs.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/db/(schema|seed)' },
    },
    {
      name: 'c6-platform-not-to-modules',
      comment:
        'C6 — platform/ is the kernel. Only container.ts, the composition root, may reach ' +
        'into modules/.',
      severity: 'error',
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-cross-module',
      comment:
        'Modules talk through the container or vendor/shared, never by reaching into a ' +
        "sibling's folder. _shared/ is the shared transport helpers.",
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/($1|_shared)/' },
    },
    {
      name: 'h8-no-db-handle-above-repository',
      comment:
        'H8 — Db / PostgresJsDatabase must not appear at ring 2 or above. Depend on a ' +
        'repository port, not on the driver handle.',
      severity: 'warn',
      from: {
        path: '^src/modules/',
        pathNot: '(/repository\\.ts|/repository/[^/]+\\.repo\\.ts)$',
      },
      to: { path: '^src/db/client' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means the ring boundary is fictional.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.json'] },
    exclude: { path: '(^src/db/migrations|\\.test\\.ts$)' },
  },
};
