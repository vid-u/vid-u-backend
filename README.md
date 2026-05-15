# VidU landing page backend

Minimal **Express + Prisma (Postgres)** API for the **VidU** marketing site (the `clipper-landing-page` app in this repo) — **waitlist only**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health`, `/` | Liveness |
| `GET` | `/health/ready` | DB check |
| `GET` | `/waitlist` | JSON counts `{ brand, creator }` (optional for dashboards) |
| `POST` | `/waitlist` | Body `{ "email": string, "role": "brand" \| "creator", "notes?": string }` |

CORS allows `FRONTEND_URL` (**comma-separated** origins; include marketing **and** app in production) and `http://localhost:*`. The **first** origin is used as the OAuth redirect base for TikTok/Meta — usually set it to the SPA (`https://www.app.vid-u.com`), then add `https://www.vid-u.com` so waitlist on the marketing site works.

## Environment

See `.env.example`. Required:

- `DATABASE_URL`
- Optional: `FRONTEND_URL` (CORS — required whenever browsers call this API from a deployed frontend)

## Scripts

```bash
npm install
cp .env.example .env   # edit DATABASE_URL
npm run prisma:migrate  # creates waitlist table
npm run prisma:generate
npm run dev
```

Docker: `docker compose up` (or `docker-compose up` if your CLI only has the older hyphenated command).

## Frontend wiring

Point `HeroVidUSection` `onWaitlistSubmit` / env `VITE_WAITLIST_URL` at `POST http://localhost:3001/waitlist` with JSON `{ email, role: "creator" | "brand" }` (match landing copy).

**Database:** use a dedicated Postgres instance; the migration creates only the `waitlist` table.
