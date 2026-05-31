# MovieFinder

An in-page, conversational AI movie & TV recommender that augments streaming sites
(Netflix first). Browser extension (MV3) + a tiny Supabase backend.

- **Product:** [`PRD.md`](PRD.md)
- **Engineering spec:** [`SPEC.md`](SPEC.md) → detailed sub-specs in [`docs/`](docs/)
- **Build plan / tickets:** [`docs/08-work-breakdown.md`](docs/08-work-breakdown.md)

## Monorepo layout

```
packages/
  shared/      @moviefinder/shared — types, zod schemas, constants, ids (the contract)
  extension/   MV3 extension (Preact + Vite + CRXJS)         [scaffolding pending]
  backend/     Supabase project (Edge Functions + migrations) [scaffolding pending]
```

## Develop

Requires **Node ≥ 20** and **pnpm 9** (via `corepack enable pnpm`).

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

## Status

Phase 0 (E0) in progress — `packages/shared` is implemented and tested. First release target
is the **"Core loop" beta** (see [`SPEC.md` §10](SPEC.md)).
