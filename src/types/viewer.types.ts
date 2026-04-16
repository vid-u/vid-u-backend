import type { UserRole } from "../generated/prisma/enums.js";

export type ViewerContext = {
  userId: string;
  role: UserRole;
};
