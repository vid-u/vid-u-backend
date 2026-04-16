import type { User } from "../generated/prisma/client.js";

export {};

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email?: string;
      };
      dbUser?: User;
    }
  }
}
