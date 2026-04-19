import { z } from "zod";

export const patchClientProfileBody = z.object({
  companyName: z.string().min(1).max(500).optional(),
  contactEmail: z.string().email().max(320).optional().or(z.literal("")),
  description: z.string().max(5000).optional(),
  websiteUrl: z.string().max(2000).optional(),
  logoUrl: z.string().max(2000).optional(),
});

const timeSlot = z.object({
  start: z.string(),
  end: z.string(),
});

/** Tester — `PATCH /profile` (identity only). */
export const patchTesterProfileBody = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    bio: z.string().max(2000).optional(),
    avatarUrl: z.string().max(2000).optional(),
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.bio !== undefined ||
      d.avatarUrl !== undefined,
    { message: "At least one field is required" },
  );

/** Tester — `PATCH /work-preferences`. */
export const patchWorkPreferencesBody = z.object({
  specializations: z.array(z.string()),
  primaryDevices: z.array(z.string()),
});

/** Tester — `PATCH /availability`. */
export const patchAvailabilityBody = z
  .object({
    preferredTimeCommitment: z.string().optional(),
    workingHours: z.record(z.array(timeSlot)).optional(),
  })
  .refine(
    (d) =>
      d.preferredTimeCommitment !== undefined || d.workingHours !== undefined,
    { message: "At least one field is required" },
  );

export type PatchClientProfileDto = z.infer<typeof patchClientProfileBody>;
export type PatchTesterProfileDto = z.infer<typeof patchTesterProfileBody>;
export type PatchWorkPreferencesDto = z.infer<typeof patchWorkPreferencesBody>;
export type PatchAvailabilityDto = z.infer<typeof patchAvailabilityBody>;
