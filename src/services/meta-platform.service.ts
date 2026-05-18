import { env, getPublicApiUrl } from "../lib/env.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/errors.js";

function graphHost(): string {
  const v = env.META_GRAPH_VERSION.startsWith("v")
    ? env.META_GRAPH_VERSION
    : `v${env.META_GRAPH_VERSION}`;
  return `https://graph.facebook.com/${v}`;
}

export function getMetaRedirectUri(): string {
  return env.META_REDIRECT_URI ?? `${getPublicApiUrl().replace(/\/$/, "")}/oauth/facebook/callback`;
}

export function assertMetaConfigured(): void {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new AppError("Meta OAuth is not configured (META_APP_ID / META_APP_SECRET)", 503);
  }
}

/** Must match permissions added under Facebook Login in the Meta app dashboard. */
export const META_OAUTH_SCOPES = ["public_profile", "user_videos", "user_posts"] as const;

export function buildMetaAuthorizeUrl(state: string): string {
  assertMetaConfigured();
  const redirectUri = getMetaRedirectUri();
  const scope = META_OAUTH_SCOPES.join(",");
  const dialogVersion = env.META_GRAPH_VERSION.startsWith("v")
    ? env.META_GRAPH_VERSION
    : `v${env.META_GRAPH_VERSION}`;
  const authUrl = new URL(`https://www.facebook.com/${dialogVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", env.META_APP_ID!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  return authUrl.href;
}

type GraphErr = { error?: { message?: string; type?: string } };

async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const u = new URL(`${graphHost()}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  const r = await fetch(u.href);
  const json = (await r.json()) as GraphErr & Record<string, unknown>;
  if (!r.ok || json.error) {
    throw new AppError(`Meta Graph error: ${json.error?.message ?? r.statusText}`, 502);
  }
  return json;
}

export async function exchangeMetaShortLivedCode(code: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  assertMetaConfigured();
  const redirectUri = getMetaRedirectUri();
  const json = (await graphGet("/oauth/access_token", {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  })) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new AppError("Meta token response missing access_token", 502);
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

export async function exchangeMetaLongLivedUserToken(shortLived: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  assertMetaConfigured();
  const json = (await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    fb_exchange_token: shortLived,
  })) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new AppError("Meta long-lived exchange failed", 502);
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 5184000 };
}

type IgBusiness = { id: string; username?: string };
type PageRow = {
  access_token?: string;
  name?: string;
  instagram_business_account?: IgBusiness;
};

export async function pickPrimaryInstagramBusiness(
  userAccessToken: string,
): Promise<{ igUserId: string; pageAccessToken: string; username?: string } | null> {
  const json = (await graphGet("/me/accounts", {
    fields: "name,access_token,instagram_business_account{id,username}",
    access_token: userAccessToken,
    limit: "50",
  })) as { data?: PageRow[] };
  const pages = json.data ?? [];
  for (const p of pages) {
    const ig = p.instagram_business_account;
    const pat = p.access_token;
    if (ig?.id && pat) {
      return { igUserId: ig.id, pageAccessToken: pat, username: ig.username };
    }
  }
  return null;
}

/** Resolves the page access token for the linked Instagram business user (or first available). */
export async function resolveMetaPageContextForUserToken(
  userAccessToken: string,
  preferredIgUserId: string,
): Promise<{ igUserId: string; pageAccessToken: string }> {
  const json = (await graphGet("/me/accounts", {
    fields: "name,access_token,instagram_business_account{id,username}",
    access_token: userAccessToken,
    limit: "50",
  })) as { data?: PageRow[] };
  const pages = json.data ?? [];
  for (const p of pages) {
    const ig = p.instagram_business_account;
    const pat = p.access_token;
    if (ig?.id === preferredIgUserId && pat) {
      return { igUserId: ig.id, pageAccessToken: pat };
    }
  }
  for (const p of pages) {
    const ig = p.instagram_business_account;
    const pat = p.access_token;
    if (ig?.id && pat) {
      return { igUserId: ig.id, pageAccessToken: pat };
    }
  }
  throw new AppError("instagram_professional_account_required", 403);
}

export async function fetchMetaMeUserId(userAccessToken: string): Promise<{ id: string; name?: string }> {
  const json = (await graphGet("/me", {
    fields: "id,name",
    access_token: userAccessToken,
  })) as { id?: string; name?: string };
  if (!json.id) throw new AppError("Meta /me missing id", 502);
  return { id: json.id, name: json.name };
}

type IgMedia = {
  id: string;
  media_type?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
};

function normalizePermalink(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    x.search = "";
    let p = x.pathname.replace(/\/$/, "").toLowerCase();
    if (!p.startsWith("/")) p = `/${p}`;
    return `${x.hostname.toLowerCase()}${p}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

export function normalizeInstagramOrFacebookContentUrl(raw: string): string {
  return normalizePermalink(raw);
}

export function isInstagramHost(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase();
    return h === "instagram.com" || h.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/** Numeric Facebook Reel / Watch video id when present in the URL. */
export function extractFacebookReelNumericId(url: string): string | null {
  const s = url.trim();
  const reel = s.match(/facebook\.com\/reel\/(\d{6,})/i);
  if (reel?.[1]) return reel[1];
  const watch = s.match(/facebook\.com\/watch\/[^\s]*[?&]v=(\d{6,})/i);
  if (watch?.[1]) return watch[1];
  return null;
}

export async function findInstagramMediaByPermalink(params: {
  igUserId: string;
  pageAccessToken: string;
  targetPermalinkNormalized: string;
  maxPages?: number;
}): Promise<IgMedia | null> {
  let url: string | null =
    `${graphHost()}/${params.igUserId}/media?fields=id,media_type,permalink,like_count,comments_count&limit=50&access_token=${encodeURIComponent(params.pageAccessToken)}`;
  let pages = 0;
  const max = params.maxPages ?? 40;
  while (url && pages < max) {
    const r = await fetch(url);
    const json = (await r.json()) as GraphErr & { data?: IgMedia[]; paging?: { next?: string } };
    if (!r.ok || json.error) {
      throw new AppError(`Meta media list: ${json.error?.message ?? r.statusText}`, 502);
    }
    for (const m of json.data ?? []) {
      if (m.permalink && normalizePermalink(m.permalink) === params.targetPermalinkNormalized) {
        return m;
      }
    }
    url = json.paging?.next ?? null;
    pages += 1;
  }
  return null;
}

async function fetchInstagramMediaInsightsPlays(
  mediaId: string,
  pageAccessToken: string,
): Promise<{ views: bigint }> {
  const metrics = ["plays", "reach", "impressions"];
  for (const metric of metrics) {
    try {
      const json = (await graphGet(`/${mediaId}/insights`, {
        metric,
        access_token: pageAccessToken,
      })) as { data?: Array<{ values?: Array<{ value?: number }> }> };
      const v = json.data?.[0]?.values?.[0]?.value;
      if (typeof v === "number" && v >= 0) {
        return { views: BigInt(Math.floor(v)) };
      }
    } catch {
      /* try next metric */
    }
  }
  throw new AppError("instagram_insights_unavailable", 502);
}

export async function fetchInstagramMediaStats(
  mediaId: string,
  pageAccessToken: string,
  mediaRow?: { like_count?: number; comments_count?: number },
): Promise<{ views: bigint; likes?: bigint; comments?: bigint }> {
  const plays = await fetchInstagramMediaInsightsPlays(mediaId, pageAccessToken);
  return {
    views: plays.views,
    likes: mediaRow?.like_count != null ? BigInt(mediaRow.like_count) : undefined,
    comments: mediaRow?.comments_count != null ? BigInt(mediaRow.comments_count) : undefined,
  };
}

export async function fetchFacebookObjectStats(
  objectId: string,
  userAccessToken: string,
): Promise<{ views: bigint; likes?: bigint; comments?: bigint }> {
  const fields = "id,permalink_url,from";
  const json = (await graphGet(`/${objectId}`, {
    fields,
    access_token: userAccessToken,
  })) as { id?: string };
  if (!json.id) throw new AppError("facebook_object_not_found", 404);

  const insightJson = (await graphGet(`/${objectId}/video_insights`, {
    metric: "total_video_impressions",
    access_token: userAccessToken,
  })) as { data?: Array<{ values?: Array<{ value?: number }> }> };
  const v = insightJson.data?.[0]?.values?.[0]?.value;
  if (typeof v === "number") {
    return { views: BigInt(Math.floor(v)), likes: undefined, comments: undefined };
  }
  throw new AppError("facebook_video_insights_unavailable", 502);
}

export async function upsertMetaCreatorAccount(params: {
  userId: string;
  accessToken: string;
  expiresIn: number;
}): Promise<void> {
  const me = await fetchMetaMeUserId(params.accessToken);
  const providerUserId = me.id;
  const displayHandle = me.name ?? me.id;
  const exp = new Date(Date.now() + Math.max(300, params.expiresIn) * 1000);

  await prisma.creatorPlatformAccount.upsert({
    where: { userId_platform: { userId: params.userId, platform: "facebook" } },
    create: {
      userId: params.userId,
      platform: "facebook",
      providerUserId,
      accessTokenEncrypted: encryptSecret(params.accessToken),
      refreshTokenEncrypted: encryptSecret(params.accessToken),
      tokenExpiresAt: exp,
      displayHandle,
      linkStatus: "connected",
      lastRefreshError: null,
      lastRefreshedAt: new Date(),
      connectedAt: new Date(),
    },
    update: {
      providerUserId,
      accessTokenEncrypted: encryptSecret(params.accessToken),
      refreshTokenEncrypted: encryptSecret(params.accessToken),
      tokenExpiresAt: exp,
      displayHandle,
      linkStatus: "connected",
      lastRefreshError: null,
      lastRefreshedAt: new Date(),
    },
  });
}

export async function markMetaReconnect(userId: string, err: string): Promise<void> {
  await prisma.creatorPlatformAccount.updateMany({
    where: { userId, platform: "facebook" },
    data: { linkStatus: "reconnect", lastRefreshError: err.slice(0, 2000) },
  });
}

export async function getValidMetaUserAccessToken(userId: string): Promise<string> {
  const row = await prisma.creatorPlatformAccount.findUnique({
    where: { userId_platform: { userId, platform: "facebook" } },
  });
  if (!row) throw new AppError("creator_platform_not_connected", 403);
  if (row.linkStatus === "reconnect") throw new AppError("platform_reconnect_required", 401);

  const token = decryptSecret(row.accessTokenEncrypted);
  const skewMs = 120_000;
  if (row.tokenExpiresAt.getTime() > Date.now() + skewMs) {
    return token;
  }

  try {
    const next = await exchangeMetaLongLivedUserToken(token);
    const exp = new Date(Date.now() + Math.max(300, next.expiresIn) * 1000);
    await prisma.creatorPlatformAccount.update({
      where: { id: row.id },
      data: {
        accessTokenEncrypted: encryptSecret(next.accessToken),
        refreshTokenEncrypted: encryptSecret(next.accessToken),
        tokenExpiresAt: exp,
        linkStatus: "connected",
        lastRefreshError: null,
        lastRefreshedAt: new Date(),
      },
    });
    return next.accessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markMetaReconnect(userId, msg);
    throw new AppError("platform_reconnect_required", 401);
  }
}
