# Cursor rules (VidU backend)

`.mdc` rules scoped to **this repo’s stack** (see `package.json` and `vidu-webapp/docs/05-tech-stack.md`). Each file owns one concern—avoid duplicating guidance across files; cross-reference filenames instead.

| File | Scope | Purpose |
|------|--------|--------|
| `trust-boundary-stack.mdc` | Always apply | Supabase Auth + Postgres, Express boundary, RLS/PostgREST posture, R2 / Xendit / TikTok / Meta scope |
| `express-http-app.mdc` | `src/**/*.ts` | `createApp`: Helmet, CORS, `express-rate-limit`, body limits, HTTP semantics, webhook mounting mechanics |
| `layered-express-modules.mdc` | `src/**/*.ts` | Routes → controllers → services layout, Zod DTOs + `types/*`, `asyncHandler`, `sendSuccess` / `AppError` boundaries |
| `security-auth-prisma.mdc` | `src/**/*.ts` | JWT authz, Zod + `validateBody`/`validateParams`/`validateQuery`, Prisma safety, webhook signatures, R2/SSRF |
| `reliability-workers-deps.mdc` | `src/**/*.ts` | Idempotency, async vs sync, workers/queues (BullMQ when added), vendor timeouts/circuits, normalization after Zod |
| `prisma-supabase-postgres.mdc` | `prisma/**`, `src/lib/prisma.ts`, `src/utils/api-response.ts` | Prisma 7 + `adapter-pg`, pooling, indexes, migrations, pagination helpers |
| `observability-winston-errors.mdc` | `src/**/*.ts` | Winston `logger`, `requestLogger`, `errorHandler`, response shapes, future metrics |

**Convention:** YAML frontmatter uses **`description`** plus either **`alwaysApply: true`** or a **`globs`** list.
