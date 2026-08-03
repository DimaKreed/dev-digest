# Onion architecture — sources and rationale

Where each rule in [SKILL.md](SKILL.md) comes from. Entries marked *(read in full)* were fetched
and read while writing this skill; the rest are corroborating material.

## Onion Architecture — primary sources

- **[The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)**
  — Jeffrey Palermo, 2008. The origin. Source of the one rule quoted at the top of SKILL.md
  ("all code can depend on layers more central, but code cannot depend on layers further out from
  the core") and of *"The database is not the center. It is external."* Also states that repository
  **interfaces** belong in the application core while implementations stay outside — the direct
  basis for **C3**. *(read in full)*
- **[part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/)** — the worked
  example (CodeCampServer).
- **[part 4 — After Four Years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)**
  — 2013 retrospective on what survived contact with real projects.
- **[Original example repository](https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture)**
  — fork of Palermo's Bitbucket sample, for the folder layout.

## Onion in context — hexagonal, DDD, vertical slices

- **[Onion Architecture — Herberto Graça](https://herbertograca.com/2017/09/21/onion-architecture/)**
  — places onion between Ports & Adapters and DDD. Its four takeaways are the spine of the ring
  table: built around an independent object model, **inner layers define interfaces and outer
  layers implement them**, coupling points toward the center, core code runs independently of
  infrastructure. *(read in full)*
- **[Sliced Onion Architecture — Oliver Drotbohm, 2023](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/)**
  — why a single monolithic domain ring is a smell: it hides business separation of concerns, and it
  implies all adapters deserve identical treatment when they don't. The vertical-slice correction
  is why our rings are declared **per module** rather than per top-level folder, and why
  `no-cross-module` is an error. *(read in full)*
- **[Vertical Slice Architecture — Milan Jovanović](https://milanjovanovic.tech/blog/vertical-slice-architecture)**
  and **[Where vertical slices fit inside the modular monolith](https://www.milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture)**
  — the slice-vs-layer trade-off, and "shared code should be earned through repeated use, not
  created preemptively". Behind the choice to keep `modules/<domain>/ports.ts` local instead of
  growing a shared ports folder.
- **[Onion Architecture Is Interesting — DZone](https://dzone.com/articles/onion-architecture-is-interesting)**
  — short critical read on where the pattern costs more than it returns.

## TypeScript / Node implementations

- **[Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS — Remo Jansen](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad)**
  — the canonical TS write-up. We take the layering and the interface-inward discipline; we
  deliberately **do not** take the DI container (see Fastify below).
- **[Onion Architecture in Node.js with TypeScript — Sankhadip Samanta](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)**
  — a smaller end-to-end example.
- **[onion-architecture-boilerplate — Melzar](https://github.com/Melzar/onion-architecture-boilerplate)**
  — reference folder layout for a Node onion project.

## Repository, mappers, transactions

- **[Atomic Repositories in Clean Architecture and TypeScript — Sentry](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)**
  — the source of **H9**. A `TransactionManagerService` port declared in the application layer,
  implemented over `db.transaction` in infrastructure; repository methods take an optional `tx` and
  fall back with `const invoker = tx ?? db`. Written against Drizzle, including the savepoint
  (nested-transaction) case and the honest cost — verbose signatures. *(read in full)*
- **[Implementing DTOs, Mappers & the Repository Pattern — Khalil Stemmler](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/)**
  and **[Understanding Domain Entities](https://khalilstemmler.com/articles/typescript-domain-driven-design/entities/)**
  — the mapper role behind **M12**: a repository persists and retrieves *domain* objects; the mapper
  translates to and from the persistence shape.
- **[Repository Pattern with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)**
  — Drizzle-specific repository wiring.
- **[Drizzle ORM Best Practices — Paul Serban](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)**
  — "define separate domain types distinct from database schemas; repositories return domain types,
  not database rows" — **H8** and **M12**.

Repo-local companion: [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) for query and
transaction syntax, [postgresql-table-design](../postgresql-table-design/SKILL.md) for schema.

## Fastify

- **[Fastify plugins as building blocks for a backend Node.js API — Snyk](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/)**
  — plugin encapsulation plus `decorate` **is** the DI seam. `app.decorate('container', …)` in
  `app.ts` is already this pattern; the gap is that services receive the whole decorated object
  instead of their own dependencies (**H7**).
- **[Fastify ecosystem](https://fastify.dev/ecosystem/)** — `@fastify/awilix` exists for heavier DI.
  We keep the hand-rolled container on purpose: it already supports typed overrides, and adding a
  container library would buy nothing that `ports.ts` + a deps object doesn't.
- **[fastify-clean-architecture](https://github.com/revell29/fastify-clean-architecture)** —
  reference project structure.

Repo-local companion: [fastify-best-practices](../fastify-best-practices/SKILL.md) for routes,
hooks, schema validation and error handling.

## Enforcement

- **[dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)**
  — `forbidden` rule syntax, `from`/`to` with `path`/`pathNot`, `$1` capture-group back-references
  (used by `no-cross-module`), `circular: true`, `dependencyTypes`, and the fact that `severity:
  "error"` is what produces a non-zero exit code. *(read in full)*
- **[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)** — the tool. Already a
  runtime dependency of `server/`, used as a library by `adapters/depgraph`. The
  `--output-type baseline` / `--ignore-known` pair is what makes `pnpm arch` a gate on *new*
  violations rather than a permanently red check.
- **[Validate dependencies according to Clean Architecture — Ken Miyashita](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c)**
  — layer-purity rules expressed as dependency-cruiser config.
- **[Avoid cross-module dependencies with dependency-cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b)**
  — the capture-group pattern for isolating sibling modules.
