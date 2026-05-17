# Docs

This service is **waitlist-only**. See the [root README](../README.md) for API and environment setup.

## Guides

- [Environment setup](./environment.md)
- [Testing real refund disbursement](./testing-refund-without-settlement-wait.md) — Xendit master → sub transfer + settlement webhooks

## Backend architecture and scaling conventions

Backend Cursor rules live under [.cursor/rules/](../.cursor/rules/README.md); they match **VidU’s stack** (Express, Zod, Winston, Prisma 7 + Supabase Postgres, etc.) and split concerns so each `.mdc` file does not repeat another—see that README for the index.
