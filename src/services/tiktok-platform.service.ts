import { env, getPublicApiUrl } from "../lib/env.js";
import { encryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { AppError } from "../utils/errors.js";

const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_VIDEO_QUERY = "https://open.tiktokapis.com/v2/video/query/";

export function getTikTokRedirectUri(): string {
  return env.TIKTOK_REDIRECT_URI ?? `${getPublicApiUrl().replace(/\/$/, "")}/oauth/tiktok/callback`;
}

export function assertTikTokConfigured(): void {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    throw new AppError("TikTok OAuth is not configured (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET)", 503);
  }
}

export function buildTikTokAuthorizeUrl(state: string, codeChallenge: string): string {
  assertTikTokConfigured();
  const redirectUri = getTikTokRedirectUri();
  const scope = ["user.info.basic", "video.list"].join(",");
  const u = new URL(TIKTOK_AUTH);
  u.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY!);
  u.searchParams.set("scope", scope);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("disable_auto_auth", "1");
  return u.href;
}

type TikTokTokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postTikTokToken(body: Record<string, string>): Promise<TikTokTokenJson> {
  const r = await fetch(TIKTOK_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await r.json()) as TikTokTokenJson;
  if (!r.ok || json.error) {
    throw new AppError(
      `TikTok token error: ${json.error_description ?? json.error ?? r.statusText}`,
      502,
    );
  }
  return json;
}

export async function exchangeTikTokCode(
  code: string,
  codeVerifier: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
}> {
  assertTikTokConfigured();
  const json = await postTikTokToken({
    client_key: env.TIKTOK_CLIENT_KEY!,
    client_secret: env.TIKTOK_CLIENT_SECRET!,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: getTikTokRedirectUri(),
  });
  if (!json.access_token || !json.refresh_token || !json.open_id) {
    throw new AppError("TikTok token response missing fields", 502);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in ?? 86400,
    refreshExpiresIn: json.refresh_expires_in ?? 31536000,
    openId: json.open_id,
  };
}

export async function refreshTikTokAccess(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
}> {
  assertTikTokConfigured();
  const json = await postTikTokToken({
    client_key: env.TIKTOK_CLIENT_KEY!,
    client_secret: env.TIKTOK_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!json.access_token || !json.open_id) {
    throw new AppError("TikTok refresh response missing fields", 502);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresIn: json.expires_in ?? 86400,
    refreshExpiresIn: json.refresh_expires_in ?? 31536000,
    openId: json.open_id,
  };
}

type TikTokUserData = {
  user?: { open_id?: string; display_name?: string; username?: string };
};

export async function fetchTikTokUserProfile(accessToken: string): Promise<{
  openId: string;
  displayHandle: string;
}> {
  const fields = ["open_id", "display_name", "username"].join(",");
  const u = new URL(TIKTOK_USER);
  u.searchParams.set("fields", fields);
  const r = await fetch(u.href, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await r.json()) as { data?: TikTokUserData; error?: { message?: string } };
  const user = json.data?.user;
  if (!r.ok || !user?.open_id) {
    throw new AppError(`TikTok user info failed: ${json.error?.message ?? r.statusText}`, 502);
  }
  const displayHandle = (user.username ?? user.display_name ?? user.open_id).trim() || user.open_id;
  return { openId: user.open_id, displayHandle };
}

type TikTokVideoQueryResponse = {
  data?: {
    videos?: Array<{
      id?: string;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_url?: string;
    }>;
  };
  error?: { code?: string; message?: string };
};

export async function queryTikTokVideos(
  accessToken: string,
  videoIds: string[],
  fields = "id,view_count,like_count,comment_count,share_url",
): Promise<
  NonNullable<NonNullable<TikTokVideoQueryResponse["data"]>["videos"]>
> {
  const u = new URL(TIKTOK_VIDEO_QUERY);
  u.searchParams.set("fields", fields);
  const r = await fetch(u.href, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filters: { video_ids: videoIds } }),
  });
  const json = (await r.json()) as TikTokVideoQueryResponse;
  if (!r.ok) {
    throw new AppError(`TikTok video query HTTP ${r.status}`, 502);
  }
  if (json.error?.code && json.error.code !== "ok") {
    throw new AppError(`TikTok video query: ${json.error.message ?? json.error.code}`, 502);
  }
  return json.data?.videos ?? [];
}

/** Resolve short links; returns canonical URL containing /@handle/video/{id} when possible. */
export async function resolveTikTokUrl(input: string): Promise<string> {
  let current = input.trim();
  for (let i = 0; i < 8; i++) {
    if (/\/@[^/]+\/video\/\d+/i.test(current)) return current;
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VidU/1.0; +https://vidu.example) AppleWebKit/537.36 Chrome/120.0.0.0",
      },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).href;
      continue;
    }
    return current;
  }
  return current;
}

export function extractTikTokVideoId(canonicalOrPartialUrl: string): string | null {
  const m = canonicalOrPartialUrl.match(/\/video\/(\d+)/i);
  return m?.[1] ?? null;
}

export async function upsertTikTokCreatorAccount(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  openIdFromToken: string;
}): Promise<void> {
  const profile = await fetchTikTokUserProfile(params.accessToken);
  if (profile.openId !== params.openIdFromToken) {
    throw new AppError("TikTok open_id mismatch", 502);
  }
  const exp = new Date(Date.now() + Math.max(60, params.expiresIn) * 1000);
  await prisma.creatorPlatformAccount.upsert({
    where: { userId_platform: { userId: params.userId, platform: "tiktok" } },
    create: {
      userId: params.userId,
      platform: "tiktok",
      providerUserId: profile.openId,
      accessTokenEncrypted: encryptSecret(params.accessToken),
      refreshTokenEncrypted: encryptSecret(params.refreshToken),
      tokenExpiresAt: exp,
      displayHandle: profile.displayHandle,
      linkStatus: "connected",
      lastRefreshError: null,
      lastRefreshedAt: new Date(),
      connectedAt: new Date(),
    },
    update: {
      providerUserId: profile.openId,
      accessTokenEncrypted: encryptSecret(params.accessToken),
      refreshTokenEncrypted: encryptSecret(params.refreshToken),
      tokenExpiresAt: exp,
      displayHandle: profile.displayHandle,
      linkStatus: "connected",
      lastRefreshError: null,
      lastRefreshedAt: new Date(),
    },
  });
}

export async function markTikTokReconnect(userId: string, err: string): Promise<void> {
  await prisma.creatorPlatformAccount.updateMany({
    where: { userId, platform: "tiktok" },
    data: { linkStatus: "reconnect", lastRefreshError: err.slice(0, 2000) },
  });
}

export async function getValidTikTokAccessToken(userId: string): Promise<string> {
  const row = await prisma.creatorPlatformAccount.findUnique({
    where: { userId_platform: { userId, platform: "tiktok" } },
  });
  if (!row) throw new AppError("creator_platform_not_connected", 403);
  if (row.linkStatus === "reconnect") throw new AppError("platform_reconnect_required", 401);

  let access = decryptSecret(row.accessTokenEncrypted);
  let refresh = decryptSecret(row.refreshTokenEncrypted);
  const skewMs = 120_000;
  if (row.tokenExpiresAt.getTime() > Date.now() + skewMs) {
    return access;
  }

  try {
    const next = await refreshTikTokAccess(refresh);
    access = next.accessToken;
    refresh = next.refreshToken;
    const exp = new Date(Date.now() + Math.max(60, next.expiresIn) * 1000);
    await prisma.creatorPlatformAccount.update({
      where: { id: row.id },
      data: {
        accessTokenEncrypted: encryptSecret(access),
        refreshTokenEncrypted: encryptSecret(refresh),
        tokenExpiresAt: exp,
        providerUserId: next.openId,
        linkStatus: "connected",
        lastRefreshError: null,
        lastRefreshedAt: new Date(),
      },
    });
    return access;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markTikTokReconnect(userId, msg);
    throw new AppError("platform_reconnect_required", 401);
  }
}
