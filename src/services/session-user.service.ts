import type { Platform, UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError } from "../utils/errors.js";
import { setUserRole } from "./auth.service.js";
import type { PatchMeBodyDto, PutMeRoleBodyDto } from "../validation/me.schema.js";

export function buildMeResponseData(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  roleProfiles: { role: UserRole; profileOnboardingComplete: boolean }[];
}) {
  const roles = user.roleProfiles.map((p) => p.role);
  const primary = roles[0] ?? null;
  const onboardingByRole = Object.fromEntries(
    user.roleProfiles.map((p) => [p.role, p.profileOnboardingComplete]),
  );
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
    roles,
    primaryRole: primary,
    profileOnboardingComplete: onboardingByRole,
    requiresRoleSelection: roles.length === 0,
  };
}

export async function patchMeUser(userId: string, body: PatchMeBodyDto) {
  const data: { name?: string | null; avatarUrl?: string | null } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl;

  return prisma.user.update({
    where: { id: userId },
    data,
    include: { roleProfiles: true },
  });
}

export async function setInitialUserRole(userId: string, body: PutMeRoleBodyDto) {
  const existing = await prisma.userRoleProfile.findMany({ where: { userId } });
  if (existing.length > 0) {
    throw new ConflictError("Role already selected");
  }

  const role = body.role as UserRole;
  await prisma.userRoleProfile.create({
    data: {
      userId,
      role,
      profileOnboardingComplete: false,
    },
  });

  try {
    await setUserRole(userId, role);
  } catch {
    /* Supabase service role optional in dev */
  }

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roleProfiles: true },
  });
  return { dbUser, role };
}

export async function completeMeOnboarding(userId: string, role: UserRole) {
  await prisma.userRoleProfile.update({
    where: { userId_role: { userId, role } },
    data: { profileOnboardingComplete: true },
  });
}

export async function listMePlatformAccounts(userId: string) {
  return prisma.creatorPlatformAccount.findMany({
    where: { userId },
    orderBy: { platform: "asc" },
  });
}

export async function deleteMePlatformAccount(userId: string, platform: Platform) {
  await prisma.creatorPlatformAccount.deleteMany({
    where: { userId, platform },
  });
}
