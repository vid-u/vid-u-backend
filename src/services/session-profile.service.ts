import type { UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { publicUrlFromObjectKey } from "../lib/publicObjectUrl.js";
import { ForbiddenError, ValidationError } from "../utils/errors.js";
import type { PutMeBrandProfileBodyDto } from "../validation/me-profile.schema.js";
import { effectiveFacebookLinkStatus } from "./meta-platform.service.js";
import { syncBrandXenditSubAccountProfile } from "./xendit-platform.service.js";

export function primaryRoleFromProfiles(
  roleProfiles: { role: UserRole }[] | undefined,
): UserRole {
  const r = roleProfiles?.[0]?.role;
  if (r !== "brand" && r !== "creator") {
    throw new ForbiddenError("No role selected");
  }
  return r;
}

function mapPlatformLinks(
  rows: Awaited<ReturnType<typeof prisma.creatorPlatformAccount.findMany>>,
) {
  return rows.map((r) => ({
    platform: r.platform,
    displayHandle: r.displayHandle,
    linkStatus: effectiveFacebookLinkStatus(r),
    connectedAt: r.connectedAt?.toISOString() ?? null,
  }));
}

export async function getMeProfilePayload(userId: string, role: UserRole) {
  if (role === "creator") {
    const rows = await prisma.creatorPlatformAccount.findMany({
      where: { userId },
      orderBy: { platform: "asc" },
    });
    return { platformLinks: mapPlatformLinks(rows) };
  }

  const bp = await prisma.brandProfile.findUnique({ where: { userId } });
  return {
    brandName: bp?.brandName ?? "",
    logoUrl: publicUrlFromObjectKey(bp?.logoObjectKey),
    website: bp?.website ?? null,
    instagram: bp?.instagram ?? null,
    facebook: bp?.facebook ?? null,
    tiktok: bp?.tiktok ?? null,
  };
}

function assertBrandLogoKey(userId: string, key: string): void {
  const prefix = `users/${userId}/brand-logo/`;
  if (!key.startsWith(prefix)) {
    throw new ValidationError("logoObjectKey must come from a brand_logo presign for this user");
  }
}

export async function putMeBrandProfile(userId: string, body: PutMeBrandProfileBodyDto) {
  if (body.logoObjectKey) assertBrandLogoKey(userId, body.logoObjectKey);

  const patch: {
    brandName?: string;
    website?: string | null;
    instagram?: string | null;
    facebook?: string | null;
    tiktok?: string | null;
    logoObjectKey?: string | null;
  } = {};

  if (body.brandName !== undefined) patch.brandName = body.brandName;
  if (body.website !== undefined) patch.website = body.website === "" ? null : body.website;
  if (body.instagram !== undefined) patch.instagram = body.instagram === "" ? null : body.instagram;
  if (body.facebook !== undefined) patch.facebook = body.facebook === "" ? null : body.facebook;
  if (body.tiktok !== undefined) patch.tiktok = body.tiktok === "" ? null : body.tiktok;
  if (body.logoObjectKey !== undefined) patch.logoObjectKey = body.logoObjectKey;

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("No profile fields to update");
  }

  const existing = await prisma.brandProfile.findUnique({ where: { userId } });
  if (!existing) {
    const brandName = patch.brandName;
    if (!brandName) {
      throw new ValidationError("brandName is required when creating a brand profile");
    }
    await prisma.brandProfile.create({
      data: {
        userId,
        brandName,
        website: patch.website ?? null,
        instagram: patch.instagram ?? null,
        facebook: patch.facebook ?? null,
        tiktok: patch.tiktok ?? null,
        logoObjectKey: patch.logoObjectKey ?? null,
      },
    });
  } else {
    await prisma.brandProfile.update({
      where: { userId },
      data: patch,
    });
  }

  if (patch.brandName !== undefined) {
    await syncBrandXenditSubAccountProfile(userId, patch.brandName);
  }
}
