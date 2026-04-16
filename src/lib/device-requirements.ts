import { z } from "zod";

/** Allowed `deviceRequirements` values (matches web `deviceOptions` slugs). */
export const DEVICE_REQUIREMENT_IDS = [
  "iphone",
  "ipad",
  "mac",
  "android",
  "android-tablet",
  "windows",
] as const;

export type DeviceRequirementId = (typeof DEVICE_REQUIREMENT_IDS)[number];

export const deviceRequirementIdSchema = z.enum(DEVICE_REQUIREMENT_IDS);

/** Dedupes and orders by canonical list; drops unknown strings (e.g. legacy free text). */
export function normalizeDeviceRequirements(ids: string[]): DeviceRequirementId[] {
  return DEVICE_REQUIREMENT_IDS.filter((id) => ids.includes(id));
}
