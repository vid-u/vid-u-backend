import type { Prisma } from "../generated/prisma/client.js";

export {};

type DbUserWithRoles = Prisma.UserGetPayload<{ include: { roleProfiles: true } }>;

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email?: string;
        role: "brand" | "creator" | null;
        jwtRoleHint?: string;
      };
      bearerToken?: string;
      dbUser?: DbUserWithRoles;
    }
  }
}
