import type { Platform } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ForbiddenError, ValidationError } from "../utils/errors.js";
import {
  extractTikTokVideoId,
  getValidTikTokAccessToken,
  queryTikTokVideos,
  resolveTikTokUrl,
} from "./tiktok-platform.service.js";
import {
  extractFacebookReelNumericId,
  fetchFacebookObjectStats,
  fetchInstagramMediaStats,
  findInstagramMediaByPermalink,
  getValidMetaUserAccessToken,
  isInstagramHost,
  normalizeInstagramOrFacebookContentUrl,
  resolveMetaPageContextForUserToken,
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
    const row = await prisma.creatorPlatformAccount.findUnique({
      where: { userId_platform: { userId: creatorUserId, platform: "facebook" } },
    });
    if (!row) {
      throw new ForbiddenError("creator_platform_not_connected");
    }
    const token = await getValidMetaUserAccessToken(creatorUserId);

    if (isInstagramHost(url)) {
      const target = normalizeInstagramOrFacebookContentUrl(url);
      const ctx = await resolveMetaPageContextForUserToken(token, row.providerUserId);
      const media = await findInstagramMediaByPermalink({
        igUserId: ctx.igUserId,
        pageAccessToken: ctx.pageAccessToken,
        targetPermalinkNormalized: target,
      });
      if (!media?.id) {
        throw new ForbiddenError("instagram_media_not_found_or_not_owned");
      }
      return fetchInstagramMediaStats(media.id, ctx.pageAccessToken, media);
    }

    const fbNumeric = extractFacebookReelNumericId(url);
    if (fbNumeric) {
      return fetchFacebookObjectStats(fbNumeric, token);
    }

    throw new ValidationError("unsupported_facebook_content_url");
  }

  throw new ValidationError("unsupported_platform");
}
