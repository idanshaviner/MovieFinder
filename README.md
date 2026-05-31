# MovieFinder

An in-page, conversational AI movie & TV recommender that augments streaming sites
(Netflix first). Browser extension (MV3) + a tiny Supabase backend.

- **Product:** [`PRD.md`](PRD.md)
- **Engineering spec:** [`SPEC.md`](SPEC.md) → detailed sub-specs in [`docs/`](docs/)
- **Build plan / tickets:** [`docs/08-work-breakdown.md`](docs/08-work-breakdown.md)
- **Delivery tracker & milestones:** [`DELIVERY.md`](DELIVERY.md) ← live status + gates

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

Milestone **M0 (Foundations)** ~95% — full stack builds, typechecks, tests, and migrations apply
on real Postgres+pgvector; blocked only on account provisioning (E0-12). Live status, gated
milestones, and the critical path are tracked in [`DELIVERY.md`](DELIVERY.md). First release
target is the **"Core loop" beta** (see [`SPEC.md` §10](SPEC.md)).
