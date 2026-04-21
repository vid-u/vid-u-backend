import { z } from "zod";
import { uuidString } from "./common.js";

/** Bug reports — full fields (matches tester bug modal). */
export const createBugSubmissionBody = z
  .object({
    campaignId: uuidString,
    kind: z.literal("bug"),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(20000),
    stepsToReproduce: z.string().max(20000).default(""),
    expectedBehavior: z.string().max(20000).optional(),
    actualBehavior: z.string().max(20000).optional(),
    /** Legacy single string; use `devices` + `browser` when possible. */
    deviceInfo: z.string().max(2000).optional(),
    /** Device labels where the issue occurred (e.g. Mac, Windows). */
    devices: z.array(z.string().min(1).max(100)).max(30).default([]),
    /** Browser id or label (e.g. safari, Chrome). */
    browser: z.string().max(200).optional(),
    additionalNotes: z.string().max(20000).optional(),
    /** External screen recording link (Loom, YouTube, Drive, …). */
    videoLink: z.string().max(2000).optional(),
    /** URLs for screenshots / files — not the primary video link. */
    attachmentUrls: z.array(z.string().max(2000)).max(50).default([]),
    /** @deprecated Merged into stored attachment URLs. Prefer `attachmentUrls`. */
    evidenceUrls: z.array(z.string().max(2000)).max(50).optional(),
    /** External reference URLs (documentation, related issues, etc.). */
    links: z.array(z.string().max(2000)).max(50).default([]),
    severity: z.enum(["critical", "high", "medium", "mild"]),
    /** Retry after `allocate_submission` succeeded but DB persistence failed. */
    chainRecovery: z
      .object({
        submissionId: uuidString,
        allocateTxSignature: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.stepsToReproduce.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stepsToReproduce is required for bug reports",
        path: ["stepsToReproduce"],
      });
    }
    if (!data.expectedBehavior?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectedBehavior is required for bug reports",
        path: ["expectedBehavior"],
      });
    }
    if (!data.actualBehavior?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "actualBehavior is required for bug reports",
        path: ["actualBehavior"],
      });
    }
    const hasDevices = data.devices.length > 0;
    const hasLegacyDevice = !!data.deviceInfo?.trim();
    if (!hasDevices && !hasLegacyDevice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "devices (at least one) or deviceInfo is required for bug reports",
        path: ["devices"],
      });
    }
  });

/** Feedback — body text + optional attachment URLs only (matches tester feedback modal). */
export const createFeedbackSubmissionBody = z.object({
  campaignId: uuidString,
  kind: z.literal("feedback"),
  feedback: z.string().min(1).max(20000),
  attachmentUrls: z.array(z.string().max(2000)).max(50).default([]),
  /** @deprecated Merged into `attachmentUrls`. */
  evidenceUrls: z.array(z.string().max(2000)).max(50).optional(),
  /** External reference URLs (documentation, related issues, etc.). */
  links: z.array(z.string().max(2000)).max(50).default([]),
  chainRecovery: z
    .object({
      submissionId: uuidString,
      allocateTxSignature: z.string().min(1),
    })
    .optional(),
});

/** Not `discriminatedUnion` — bug branch uses `.superRefine` (`ZodEffects`). */
export const createSubmissionBody = z.union([
  createBugSubmissionBody,
  createFeedbackSubmissionBody,
]);

/** Tester — after `POST /submissions/create` and presigned PUTs under `campaigns/.../submissions/:id/`, persist keys. */
export const patchTesterSubmissionEvidenceBody = z.object({
  attachmentUrls: z.array(z.string().max(2000)).min(1).max(50),
});

export const submissionIdParams = z.object({
  id: uuidString,
});

const submissionListPaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Optional `status` filter for submission lists. Matches Prisma `SubmissionStatus`;
 * also accepts `in-review` (same spelling as API response bodies).
 */
export const submissionStatusQueryParam = z.preprocess(
  (raw) => {
    if (raw === "" || raw === undefined || raw === null) return undefined;
    if (raw === "in-review") return "in_review";
    return raw;
  },
  z
    .enum(["draft", "submitted", "in_review", "triaged", "approved", "rejected", "disputed"])
    .optional(),
);

/**
 * @deprecated Use {@link listTesterSubmissionsQuery} or {@link listClientCampaignSubmissionsQuery}.
 * Service layer still accepts this shape for `listSubmissions`.
 */
export const listSubmissionsQuery = submissionListPaginationQuery.extend({
  campaignId: uuidString.optional(),
  mine: z.enum(["true"]).optional(),
  status: submissionStatusQueryParam,
});

export type ListSubmissionsQueryDto = z.infer<typeof listSubmissionsQuery>;

/** Tester — `GET /submissions` (optional `campaignId` filter). */
export const listTesterSubmissionsQuery = submissionListPaginationQuery.extend({
  campaignId: uuidString.optional(),
  status: submissionStatusQueryParam,
});

export type ListTesterSubmissionsQueryDto = z.infer<typeof listTesterSubmissionsQuery>;

/** Client — `GET /client/submissions` — optional `campaignId` filters to one campaign; omit for all of the client’s campaigns. */
export const listClientCampaignSubmissionsQuery = submissionListPaginationQuery.extend({
  campaignId: uuidString.optional(),
  status: submissionStatusQueryParam,
});

export type ListClientCampaignSubmissionsQueryDto = z.infer<
  typeof listClientCampaignSubmissionsQuery
>;

export const clientCampaignIdParams = z.object({
  campaignId: uuidString,
});

/** @deprecated Legacy path included `campaignId` — use {@link clientSubmissionParams}. */
export const clientCampaignSubmissionParams = z.object({
  campaignId: uuidString,
  submissionId: uuidString,
});

/** Client — `GET|PATCH|POST /client/submissions/:submissionId/…`. */
export const clientSubmissionParams = z.object({
  submissionId: uuidString,
});

export const patchSubmissionBody = z.object({
  severity: z.enum(["critical", "high", "medium", "mild"]).optional(),
});

export const commentBody = z.object({
  body: z.string().min(1).max(10000),
  parentId: uuidString.optional(),
});

export const approveSubmissionBody = z.object({
  severity: z.enum(["critical", "high", "medium", "mild"]).optional(),
  grossUsdc: z.union([z.number(), z.string()]).optional(),
  approveTxSignature: z.string().min(1).optional(),
});

export const rejectSubmissionBody = z.object({
  rejectionText: z.string().min(1).max(5000),
  /** Only if the API cannot use `BACKEND_AUTHORITY` — normal flow signs `reject_submission` on the server. */
  rejectTxSignature: z.string().min(1).optional(),
});

export type CreateSubmissionDto = z.infer<typeof createSubmissionBody>;
export type PatchTesterSubmissionEvidenceDto = z.infer<typeof patchTesterSubmissionEvidenceBody>;
export type PatchSubmissionDto = z.infer<typeof patchSubmissionBody>;
export type CommentDto = z.infer<typeof commentBody>;
export type ApproveSubmissionDto = z.infer<typeof approveSubmissionBody>;
export type RejectSubmissionDto = z.infer<typeof rejectSubmissionBody>;
