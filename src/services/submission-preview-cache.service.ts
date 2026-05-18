import type { Platform } from "../generated/prisma/enums.js";
import { normalizeContentUrl } from "./platform-content.service.js";

export type PreviewStatsPayload = {
  views: string;
  /** TikTok */
  likes?: string;
  comments?: string;
  /** Facebook Reels */
  reactions?: string;
  engagements?: string;
};

type CacheEntry = { payload: PreviewStatsPayload; expiresAt: number };

const store = new Map<string, CacheEntry>();
const TTL_MS = 60_000;
const MAX_KEYS = 2000;

function evictIfNeeded(): void {
  if (store.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  if (store.size <= MAX_KEYS) return;
  const it = store.keys();
  const first = it.next().value;
  if (first) store.delete(first);
}

function cacheKey(creatorUserId: string, url: string, platform: Platform): string {
  return `${creatorUserId}:${platform}:${normalizeContentUrl(url, platform)}`;
}

export function getCachedSubmissionPreview(
  creatorUserId: string,
  url: string,
  platform: Platform,
): PreviewStatsPayload | undefined {
  const key = cacheKey(creatorUserId, url, platform);
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.payload;
}

export function setCachedSubmissionPreview(
  creatorUserId: string,
  url: string,
  platform: Platform,
  payload: PreviewStatsPayload,
): void {
  evictIfNeeded();
  const key = cacheKey(creatorUserId, url, platform);
  store.set(key, { payload, expiresAt: Date.now() + TTL_MS });
}
