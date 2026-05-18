import type { Platform } from "../generated/prisma/enums.js";
import { ForbiddenError, ValidationError } from "../utils/errors.js";
import {
  extractTikTokVideoId,
  getValidTikTokAccessToken,
  queryTikTokVideos,
  resolveTikTokUrl,
} from "./tiktok-platform.service.js";
import {
  assertFacebookReadyForSubmission,
  extractFacebookReelNumericId,
  fetchFacebookObjectStats,
  isInstagramHost,
} from "./meta-platform.service.js";

/** Stable dedupe key stored on `Submission.normalizedUrl`. */
export function normalizeContentUrl(url: string, platform: Platform): string {
  const u = url.trim().toLowerCase();
  return `${platform}:${u}`;
}

/** Recover the original submission URL from `normalizedUrl`. */
export function contentUrlFromNormalized(normalizedUrl: string, platform: Platform): string {
  const prefix = `${platform}:`;
  if (normalizedUrl.toLowerCase().startsWith(prefix)) {
    return normalizedUrl.slice(prefix.length);
  }
  return normalizedUrl;
}

export async function fetchCreatorContentStats(
  url: string,
  platform: Platform,
  creatorUserId: string,
): Promise<{ views: bigint; likes?: bigint; comments?: bigint }> {
  if (platform === "tiktok") {
    const access = await getValidTikTokAccessToken(creatorUserId);
    const resolved = await resolveTikTokUrl(url);
    const videoId = extractTikTokVideoId(resolved);
    if (!videoId) {
      throw new ValidationError("invalid_tiktok_url");
    }
    const videos = await queryTikTokVideos(access, [videoId]);
    const v = videos.find((row) => row.id === videoId);
    if (!v) {
      throw new ForbiddenError("tiktok_video_not_owned_or_missing");
    }
    return {
      views: BigInt(v.view_count ?? 0),
      likes: v.like_count != null ? BigInt(v.like_count) : undefined,
      comments: v.comment_count != null ? BigInt(v.comment_count) : undefined,
    };
  }

  if (platform === "facebook") {
    await assertFacebookReadyForSubmission(creatorUserId);

    if (isInstagramHost(url)) {
      throw new ValidationError("instagram_urls_not_supported_for_facebook_connect");
    }

    const fbNumeric = extractFacebookReelNumericId(url);
    if (fbNumeric) {
      return fetchFacebookObjectStats(fbNumeric, creatorUserId);
    }

    throw new ValidationError("unsupported_facebook_content_url");
  }

  throw new ValidationError("unsupported_platform");
}
