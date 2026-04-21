# BugHyve backend — documentation

Guides for running this API in development and production.

| Guide | Description |
|-------|-------------|
| [Supabase setup](./supabase-setup.md) | Project setup, **Web3/Solana auth**, Postgres URLs, keys, Prisma, `/auth/sync` |
| [Deployment](./deployment.md) | Environment variables, build, migrations, health checks, and hosting patterns |
| [Cloudflare R2](./cloudflare-r2.md) | Bucket, env vars, public avatars/logos, private evidence, CORS |
| [Campaign funding sync](./campaign-funding-sync.md) | **GET/POST** `/client/campaigns/:id/sync-fund` — recover DB state when on-chain funding succeeded but `POST .../fund` failed |

**Routes:** `GET /` returns a short JSON route list (dev). **HTTP examples** and request/response shapes: [`postman/BugHyve-API.postman_collection.json`](../postman/BugHyve-API.postman_collection.json). The [root README](../README.md) summarizes how this package fits the monorepo.
