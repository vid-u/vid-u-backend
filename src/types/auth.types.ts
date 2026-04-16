import type { SyncBodyDto } from "../validation/auth.schema.js";

export type SyncUserInput = SyncBodyDto & { authUserId: string };
