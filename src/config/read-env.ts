import { z } from "zod";

const percentSchema = z.coerce.number().min(0).max(1);

export function readEnvPercent(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = percentSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export function readEnvMoney(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Non-negative integer from env; invalid or missing uses `fallback`. */
export function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}
