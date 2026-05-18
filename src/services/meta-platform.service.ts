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

export type MetaAppKind = "login" | "page";

const META_LOGIN_SCOPES_DEFAULT = ["public_profile", "user_videos", "user_posts"] as const;
const META_PAGE_SCOPES_DEFAULT = [
  "public_profile",
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
] as const;

export function getMetaLoginAppId(): string {
  return env.META_LOGIN_APP_ID ?? env.META_APP_ID ?? "";
}

export function getMetaLoginAppSecret(): string {
  return env.META_LOGIN_APP_SECRET ?? env.META_APP_SECRET ?? "";
}

export function getMetaPageAppId(): string {
  return env.META_PAGE_APP_ID ?? "";
}

export function getMetaPageAppSecret(): string {
  return env.META_PAGE_APP_SECRET ?? "";
}

export function isMetaDualAppEnabled(): boolean {
  return Boolean(getMetaPageAppId() && getMetaPageAppSecret());
}

export function getMetaRedirectUri(kind: MetaAppKind): string {
  const base = env.META_REDIRECT_URI ?? `${getPublicApiUrl().replace(/\/$/, "")}/oauth/facebook`;
  const root = base.replace(/\/oauth\/facebook\/callback\/?$/i, "/oauth/facebook");
  const path = kind === "page" ? `${root}/page/callback` : `${root}/callback`;
  return path;
}

export function assertMetaLoginConfigured(): void {
  if (!getMetaLoginAppId() || !getMetaLoginAppSecret()) {
    throw new AppError(
      "Meta Login OAuth is not configured (META_LOGIN_APP_ID / META_LOGIN_APP_SECRET or META_APP_ID / META_APP_SECRET)",
      503,
    );
  }
}

export function assertMetaPageConfigured(): void {
  if (!isMetaDualAppEnabled()) {
    throw new AppError("Meta Page OAuth is not configured (META_PAGE_APP_ID / META_PAGE_APP_SECRET)", 503);
  }
}

/** @deprecated Use {@link assertMetaLoginConfigured}. */
export function assertMetaConfigured(): void {
  assertMetaLoginConfigured();
}

function parseScopeList(raw: string | undefined, fallback: readonly string[]): string[] {
  if (!raw?.trim()) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getMetaLoginOAuthScopes(): string[] {
  return parseScopeList(
    env.META_LOGIN_OAUTH_SCOPES ?? env.META_OAUTH_SCOPES,
    META_LOGIN_SCOPES_DEFAULT,
  );
}

export function getMetaPageOAuthScopes(): string[] {
  return parseScopeList(env.META_PAGE_OAUTH_SCOPES, META_PAGE_SCOPES_DEFAULT);
}

/** @deprecated Use {@link getMetaLoginOAuthScopes}. */
export function getMetaOAuthScopes(): string[] {
  return getMetaLoginOAuthScopes();
}

export const META_OAUTH_SCOPES_DEFAULT = META_LOGIN_SCOPES_DEFAULT;
export const META_OAUTH_SCOPES = META_LOGIN_SCOPES_DEFAULT;

function metaAppCredentials(kind: MetaAppKind): { appId: string; appSecret: string } {
  if (kind === "page") {
    return { appId: getMetaPageAppId(), appSecret: getMetaPageAppSecret() };
  }
  return { appId: getMetaLoginAppId(), appSecret: getMetaLoginAppSecret() };
}

export function buildMetaAuthorizeUrl(state: string, kind: MetaAppKind = "login"): string {
  if (kind === "page") assertMetaPageConfigured();
  else assertMetaLoginConfigured();

  const { appId } = metaAppCredentials(kind);
  const redirectUri = getMetaRedirectUri(kind);
  const scope =
    kind === "page" ? getMetaPageOAuthScopes().join(",") : getMetaLoginOAuthScopes().join(",");
  const dialogVersion = env.META_GRAPH_VERSION.startsWith("v")
    ? env.META_GRAPH_VERSION
    : `v${env.META_GRAPH_VERSION}`;
  const authUrl = new URL(`https://www.facebook.com/${dialogVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  return authUrl.href;
}

/** Starts dual-app connect with the Facebook Login app. */
export function buildMetaLoginAuthorizeUrl(state: string): string {
  return buildMetaAuthorizeUrl(state, "login");
}

/** Second step when META_PAGE_APP_* is set. */
export function buildMetaPageAuthorizeUrl(state: string): string {
  return buildMetaAuthorizeUrl(state, "page");
}

type GraphErr = { error?: { message?: string; type?: string } };

function mapMetaGraphMessageToCode(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("read_insights")) return "meta_read_insights_required";
  if (m.includes("unsupported get request") || m.includes("does not exist")) {
    return "facebook_reel_not_accessible";
  }
  return null;
}

async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const u = new URL(`${graphHost()}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  const r = await fetch(u.href);
  const json = (await r.json()) as GraphErr & Record<string, unknown>;
  if (!r.ok || json.error) {
    const raw = json.error?.message ?? r.statusText;
    const code = mapMetaGraphMessageToCode(raw);
    if (code === "meta_read_insights_required") {
      throw new AppError(code, 403);
    }
    if (code) {
      throw new AppError(code, 403);
    }
    throw new AppError(`Meta Graph error: ${raw}`, 502);
  }
  return json;
}

export async function exchangeMetaShortLivedCode(
  code: string,
  kind: MetaAppKind = "login",
): Promise<{ accessToken: string; expiresIn: number }> {
  if (kind === "page") assertMetaPageConfigured();
  else assertMetaLoginConfigured();
  const { appId, appSecret } = metaAppCredentials(kind);
  const redirectUri = getMetaRedirectUri(kind);
  const json = (await graphGet("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new AppError("Meta token response missing access_token", 502);
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

export async function exchangeMetaLongLivedUserToken(
  shortLived: string,
  kind: MetaAppKind = "login",
): Promise<{ accessToken: string; expiresIn: number }> {
  const { appId, appSecret } = metaAppCredentials(kind);
  const json = (await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
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

const FACEBOOK_REEL_VIEW_METRICS = [
  "fb_reels_total_plays",
  "blue_reels_play_count",
  "total_video_impressions",
  "total_video_views",
] as const;

type FbEngagement = {
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
};

type FbReelMeta = { id?: string; from?: { id?: string } } & FbEngagement;

async function listFacebookPages(
  userAccessToken: string,
): Promise<Array<{ id?: string; access_token?: string }>> {
  const json = (await graphGet("/me/accounts", {
    fields: "id,name,access_token",
    access_token: userAccessToken,
    limit: "50",
  })) as { data?: Array<{ id?: string; access_token?: string }> };
  return json.data ?? [];
}

async function fetchFacebookVideoInsightPlays(
  videoId: string,
  accessToken: string,
): Promise<bigint> {
  for (const metric of FACEBOOK_REEL_VIEW_METRICS) {
    try {
      const json = (await graphGet(`/${videoId}/video_insights`, {
        metric,
        period: "lifetime",
        access_token: accessToken,
      })) as { data?: Array<{ values?: Array<{ value?: number }> }> };
      const v = json.data?.[0]?.values?.[0]?.value;
      if (typeof v === "number" && v >= 0) {
        return BigInt(Math.floor(v));
      }
    } catch {
      /* try next metric */
    }
  }
  throw new AppError("facebook_video_insights_unavailable", 403);
}

function engagementFromMeta(meta: FbEngagement): {
  likes?: bigint;
  comments?: bigint;
} {
  const likes =
    meta.likes?.summary?.total_count ?? meta.reactions?.summary?.total_count;
  return {
    likes: likes != null ? BigInt(likes) : undefined,
    comments:
      meta.comments?.summary?.total_count != null
        ? BigInt(meta.comments.summary.total_count)
        : undefined,
  };
}

async function loadFacebookReelMeta(reelId: string, accessToken: string): Promise<FbReelMeta> {
  try {
    const meta = (await graphGet(`/${reelId}`, {
      fields: "id,from{id},permalink_url,likes.summary(true),comments.summary(true)",
      access_token: accessToken,
    })) as FbReelMeta;
    if (!meta.id) throw new AppError("facebook_object_not_found", 404);
    return meta;
  } catch (e) {
    const retryAsPost =
      e instanceof AppError &&
      (e.message === "facebook_reel_not_accessible" ||
        e.message === "facebook_object_not_found");
    if (!retryAsPost) throw e;
    const meta = (await graphGet(`/${reelId}`, {
      fields:
        "id,from{id},permalink_url,reactions.summary(true),comments.summary(true)",
      access_token: accessToken,
    })) as FbReelMeta;
    if (!meta.id) throw new AppError("facebook_object_not_found", 404);
    return meta;
  }
}

function isFacebookReelOwnedByCreator(
  meta: FbReelMeta,
  creatorUserId: string,
  managedPageIds: string[],
): boolean {
  const fromId = meta.from?.id;
  if (!fromId) return true;
  if (fromId === creatorUserId) return true;
  return managedPageIds.includes(fromId);
}

/** Login token + optional Page-app token + Page access tokens. */
export async function fetchFacebookObjectStats(
  objectId: string,
  creatorUserId: string,
): Promise<{ views: bigint; likes?: bigint; comments?: bigint }> {
  const loginToken = await getValidMetaLoginAccessToken(creatorUserId);
  const pageAppToken = await getValidMetaPageAccessTokenOptional(creatorUserId);
  const me = await fetchMetaMeUserId(loginToken);

  let pages: Array<{ id?: string; access_token?: string }> = [];
  const accountsToken = pageAppToken ?? loginToken;
  try {
    pages = await listFacebookPages(accountsToken);
  } catch {
    /* token may lack pages_show_list */
  }

  const pageIds = pages.map((p) => p.id).filter((id): id is string => Boolean(id));
  const tokens = [
    loginToken,
    ...(pageAppToken ? [pageAppToken] : []),
    ...pages.map((p) => p.access_token).filter((t): t is string => Boolean(t)),
  ];

  let confirmedOwned = false;
  let sawForeignOwner = false;

  for (const token of tokens) {
    let meta: FbReelMeta;
    try {
      meta = await loadFacebookReelMeta(objectId, token);
    } catch (e) {
      if (e instanceof AppError && e.message === "meta_read_insights_required") throw e;
      continue;
    }

    if (!isFacebookReelOwnedByCreator(meta, me.id, pageIds)) {
      sawForeignOwner = true;
      continue;
    }

    confirmedOwned = true;
    try {
      const views = await fetchFacebookVideoInsightPlays(objectId, token);
      return { views, ...engagementFromMeta(meta) };
    } catch (e) {
      if (e instanceof AppError && e.message === "meta_read_insights_required") throw e;
      /* try next token for insights */
    }
  }

  if (confirmedOwned) {
    throw new AppError("facebook_video_insights_unavailable", 403);
  }
  if (sawForeignOwner) {
    throw new AppError("facebook_reel_not_owned", 403);
  }
  throw new AppError("facebook_reel_not_owned", 403);
}

export async function upsertMetaLoginToken(params: {
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

export async function upsertMetaPageToken(params: {
  userId: string;
  accessToken: string;
  expiresIn: number;
}): Promise<void> {
  const exp = new Date(Date.now() + Math.max(300, params.expiresIn) * 1000);
  const existing = await prisma.creatorPlatformAccount.findUnique({
    where: { userId_platform: { userId: params.userId, platform: "facebook" } },
  });
  if (!existing) {
    throw new AppError("creator_platform_not_connected", 403);
  }
  await prisma.creatorPlatformAccount.update({
    where: { id: existing.id },
    data: {
      pageAccessTokenEncrypted: encryptSecret(params.accessToken),
      pageTokenExpiresAt: exp,
      linkStatus: "connected",
      lastRefreshError: null,
      lastRefreshedAt: new Date(),
    },
  });
}

/** @deprecated Use {@link upsertMetaLoginToken}. */
export async function upsertMetaCreatorAccount(params: {
  userId: string;
  accessToken: string;
  expiresIn: number;
}): Promise<void> {
  return upsertMetaLoginToken(params);
}

export async function markMetaReconnect(userId: string, err: string): Promise<void> {
  await prisma.creatorPlatformAccount.updateMany({
    where: { userId, platform: "facebook" },
    data: { linkStatus: "reconnect", lastRefreshError: err.slice(0, 2000) },
  });
}

async function refreshMetaLoginTokenRow(
  row: {
    id: string;
    userId: string;
    accessTokenEncrypted: string;
    tokenExpiresAt: Date;
    linkStatus: string;
  },
): Promise<string> {
  if (row.linkStatus === "reconnect") throw new AppError("platform_reconnect_required", 401);

  const token = decryptSecret(row.accessTokenEncrypted);
  const skewMs = 120_000;
  if (row.tokenExpiresAt.getTime() > Date.now() + skewMs) {
    return token;
  }

  try {
    const next = await exchangeMetaLongLivedUserToken(token, "login");
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
    await markMetaReconnect(row.userId, msg);
    throw new AppError("platform_reconnect_required", 401);
  }
}

async function refreshMetaPageTokenRow(
  row: {
    id: string;
    userId: string;
    pageAccessTokenEncrypted: string | null;
    pageTokenExpiresAt: Date | null;
    linkStatus: string;
  },
): Promise<string> {
  if (!row.pageAccessTokenEncrypted || !row.pageTokenExpiresAt) {
    throw new AppError("meta_page_connect_required", 403);
  }
  if (row.linkStatus === "reconnect") throw new AppError("platform_reconnect_required", 401);

  const token = decryptSecret(row.pageAccessTokenEncrypted);
  const skewMs = 120_000;
  if (row.pageTokenExpiresAt.getTime() > Date.now() + skewMs) {
    return token;
  }

  try {
    const next = await exchangeMetaLongLivedUserToken(token, "page");
    const exp = new Date(Date.now() + Math.max(300, next.expiresIn) * 1000);
    await prisma.creatorPlatformAccount.update({
      where: { id: row.id },
      data: {
        pageAccessTokenEncrypted: encryptSecret(next.accessToken),
        pageTokenExpiresAt: exp,
        lastRefreshError: null,
        lastRefreshedAt: new Date(),
      },
    });
    return next.accessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markMetaReconnect(row.userId, msg);
    throw new AppError("platform_reconnect_required", 401);
  }
}

export async function getValidMetaLoginAccessToken(userId: string): Promise<string> {
  const row = await prisma.creatorPlatformAccount.findUnique({
    where: { userId_platform: { userId, platform: "facebook" } },
  });
  if (!row) throw new AppError("creator_platform_not_connected", 403);
  return refreshMetaLoginTokenRow(row);
}

/** Page-app token when dual Meta apps are configured; null if single-app mode. */
export async function getValidMetaPageAccessTokenOptional(
  userId: string,
): Promise<string | null> {
  if (!isMetaDualAppEnabled()) return null;
  const row = await prisma.creatorPlatformAccount.findUnique({
    where: { userId_platform: { userId, platform: "facebook" } },
  });
  if (!row?.pageAccessTokenEncrypted) return null;
  return refreshMetaPageTokenRow({
    id: row.id,
    userId: row.userId,
    pageAccessTokenEncrypted: row.pageAccessTokenEncrypted,
    pageTokenExpiresAt: row.pageTokenExpiresAt,
    linkStatus: row.linkStatus,
  });
}

/** @deprecated Use {@link getValidMetaLoginAccessToken}. */
export async function getValidMetaUserAccessToken(userId: string): Promise<string> {
  return getValidMetaLoginAccessToken(userId);
}

export function getMetaPageOAuthStartUrl(): string {
  return `${getPublicApiUrl().replace(/\/$/, "")}/oauth/facebook/page/start`;
}
