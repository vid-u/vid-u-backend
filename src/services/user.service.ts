import type { Prisma } from "../generated/prisma/client.js";
import type { UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import type { SupabaseJwtPayload } from "../lib/supabase-auth.js";

export type AuthUserRow = Prisma.UserGetPayload<{ include: { roleProfiles: true } }>;

export async function ensureUserFromJwt(payload: SupabaseJwtPayload): Promise<AuthUserRow> {
  const id = String(payload.sub ?? "");
  if (!id) {
    throw new Error("Invalid token subject");
  }
  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.user_metadata?.email === "string"
        ? (payload.user_metadata.email as string)
        : `${id}@users.invalid`;

  const name =
    typeof payload.user_metadata?.full_name === "string"
      ? (payload.user_metadata.full_name as string)
      : typeof payload.user_metadata?.name === "string"
        ? (payload.user_metadata.name as string)
        : null;

  const avatarUrl =
    typeof payload.user_metadata?.avatar_url === "string"
      ? (payload.user_metadata.avatar_url as string)
      : null;

  const userRow = await prisma.user.upsert({
    where: { id },
    create: { id, email, name, avatarUrl },
    update: { email, name: name ?? undefined, avatarUrl: avatarUrl ?? undefined },
  });
  return prisma.user.findUniqueOrThrow({
    where: { id: userRow.id },
    include: { roleProfiles: true },
  });
}

export async function getRoleProfiles(userId: string) {
  return prisma.userRoleProfile.findMany({ where: { userId } });
}

export async function ensureRoleProfile(userId: string, role: UserRole) {
  return prisma.userRoleProfile.upsert({
    where: { userId_role: { userId, role } },
    create: { userId, role, profileOnboardingComplete: false },
    update: {},
  });
}

export function readViduRoleFromJwt(payload: SupabaseJwtPayload): "brand" | "creator" | null {
  const r = payload.app_metadata?.vidu_role;
  if (r === "brand" || r === "creator") return r;
  return null;
}
