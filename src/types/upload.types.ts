import type { UserRole } from "../generated/prisma/enums.js";
import type { PresignDownloadDto, PresignUploadDto } from "../validation/upload.schema.js";

export type PresignUploadInput = PresignUploadDto & {
  userId: string;
  role: UserRole;
};

export type PresignDownloadInput = PresignDownloadDto & {
  userId: string;
  role: UserRole;
};
