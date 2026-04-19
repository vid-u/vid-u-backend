import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type {
  PatchAvailabilityDto,
  PatchClientProfileDto,
  PatchTesterProfileDto,
  PatchWorkPreferencesDto,
} from "../validation/profile.schema.js";
import { NotFoundError } from "../utils/errors.js";

export async function ensureClientProfile(
  userId: string,
  email?: string | null,
) {
  const existing = await prisma.clientProfile.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return prisma.clientProfile.create({
    data: {
      userId,
      companyName: "My organization",
      contactEmail: email ?? null,
    },
  });
}

/** Client — `GET /client/profile` / `PATCH /client/profile` response shape (company form fields only). */
export async function getClientProfilePayload(
  userId: string,
  email?: string | null,
) {
  const p = await ensureClientProfile(userId, email);
  const contactEmail = p.contactEmail ?? email ?? null;
  return {
    companyName: p.companyName,
    description: p.description ?? null,
    contactEmail: contactEmail === "" ? null : contactEmail,
    websiteUrl: p.websiteUrl ?? null,
    logoUrl: p.logoUrl ?? null,
  };
}

export async function updateClientProfile(
  userId: string,
  data: PatchClientProfileDto,
  email?: string | null,
) {
  await prisma.clientProfile.upsert({
    where: { userId },
    create: {
      userId,
      companyName: data.companyName ?? "My organization",
      contactEmail: data.contactEmail ?? email ?? null,
      description: data.description,
      websiteUrl: data.websiteUrl,
      logoUrl: data.logoUrl,
    },
    update: {
      ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
      ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail || null } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
    },
  });
  return getClientProfilePayload(userId, email);
}

/** Tester — `GET /profile` (identity fields only). */
export async function getTesterProfilePayload(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) throw new NotFoundError("User not found");
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.displayName ?? undefined,
    bio: user.bio ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  };
}

/** Tester — `PATCH /profile`. */
export async function updateTesterProfile(
  userId: string,
  data: PatchTesterProfileDto,
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
    },
  });

  return getTesterProfilePayload(userId);
}

function mapWorkPreferences(row: {
  specializations: string[];
  primaryDevices: string[];
}) {
  return {
    specializations: row.specializations,
    primaryDevices: row.primaryDevices,
  };
}

/** Tester — `GET /work-preferences`. */
export async function getWorkPreferencesPayload(userId: string) {
  const row = await prisma.testerWorkPreferences.findUnique({
    where: { userId },
  });
  return {
    workPreferences: row ? mapWorkPreferences(row) : null,
  };
}

/** Tester — `PATCH /work-preferences`. */
export async function updateWorkPreferences(
  userId: string,
  data: PatchWorkPreferencesDto,
) {
  const upserted = await prisma.testerWorkPreferences.upsert({
    where: { userId },
    create: {
      userId,
      specializations: data.specializations,
      primaryDevices: data.primaryDevices,
    },
    update: {
      specializations: data.specializations,
      primaryDevices: data.primaryDevices,
    },
  });
  return { workPreferences: mapWorkPreferences(upserted) };
}

/** Tester — `GET /availability`. */
export async function getAvailabilityPayload(userId: string) {
  const row = await prisma.testerAvailability.findUnique({
    where: { userId },
  });
  return {
    availability: row
      ? {
          preferredTimeCommitment: row.preferredTimeCommitment,
          workingHours: row.workingHours as Record<
            string,
            { start: string; end: string }[]
          > | null,
        }
      : null,
  };
}

/** Tester — `PATCH /availability`. */
export async function updateAvailability(
  userId: string,
  data: PatchAvailabilityDto,
) {
  const wh = data.workingHours as Prisma.InputJsonValue | undefined;

  const upserted = await prisma.testerAvailability.upsert({
    where: { userId },
    create: {
      userId,
      preferredTimeCommitment: data.preferredTimeCommitment,
      workingHours: wh ?? Prisma.JsonNull,
    },
    update: {
      ...(data.preferredTimeCommitment !== undefined
        ? { preferredTimeCommitment: data.preferredTimeCommitment }
        : {}),
      ...(data.workingHours !== undefined
        ? { workingHours: wh ?? Prisma.JsonNull }
        : {}),
    },
  });

  return {
    availability: {
      preferredTimeCommitment: upserted.preferredTimeCommitment,
      workingHours: upserted.workingHours as Record<
        string,
        { start: string; end: string }[]
      > | null,
    },
  };
}
