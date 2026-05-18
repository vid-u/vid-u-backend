import { env } from "./env.js";

/** First SPA origin from `FRONTEND_URL` (OAuth post-login redirect base). */
export function oauthFrontendBase(): string {
  const raw = env.FRONTEND_URL ?? "http://localhost:5173";
  return raw.split(",")[0]!.trim().replace(/\/$/, "");
}
