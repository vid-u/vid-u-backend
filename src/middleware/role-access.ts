import { UserRole } from "../generated/prisma/enums.js";
import { requireRole } from "./auth.js";

/** Brand-only routes (must have a `user_role_profile` with `brand`). */
export const requireViduBrand = requireRole(UserRole.brand);

/** Creator-only routes (must have a `user_role_profile` with `creator`). */
export const requireViduCreator = requireRole(UserRole.creator);
