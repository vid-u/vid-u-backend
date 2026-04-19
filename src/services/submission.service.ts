import {
  CampaignStatus,
  PayoutStatus,
  SubmissionKind,
  SubmissionSeverity,
  SubmissionStatus,
  UserRole,
} from "../generated/prisma/enums.js";
import type { Campaign, Submission } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { stubTxSignature } from "../lib/stubChain.js";
import { dec, prisma } from "../lib/prisma.js";
import { buildPaginationMeta, pageToOffset } from "../utils/api-response.js";
import type { SeverityRewards } from "../types/campaign.types.js";
import type {
  ApproveSubmissionInput,
  CreateSubmissionInput,
  RejectSubmissionInput,
} from "../types/submission.types.js";
import type { ListSubmissionsQueryDto } from "../validation/submission.schema.js";
import type { ViewerContext } from "../types/viewer.types.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";

function toDecimal(v: number | string): Prisma.Decimal {
  return new Prisma.Decimal(typeof v === "number" ? String(v) : v);
}

function midpointForSeverity(
  severity: SubmissionSeverity,
  rewards: Prisma.JsonValue | null,
): Prisma.Decimal {
  const defaults: Record<SubmissionSeverity, Prisma.Decimal> = {
    critical: new Prisma.Decimal(400),
    high: new Prisma.Decimal(200),
    medium: new Prisma.Decimal(75),
    mild: new Prisma.Decimal(25),
  };
  if (!rewards || typeof rewards !== "object" || Array.isArray(rewards)) {
    return defaults[severity];
  }
  const r = rewards as SeverityRewards;
  const tier = r[severity];
  if (!tier) return defaults[severity];
  const a = toDecimal(tier.min);
  const b = toDecimal(tier.max);
  return a.plus(b).dividedBy(2);
}

/** Human-readable line for search / legacy clients when `devices` + `browser` are set. */
function buildDeviceInfo(input: {
  devices: string[];
  browser?: string | null;
  deviceInfo?: string | null;
}): string | undefined {
  if (input.deviceInfo?.trim()) return input.deviceInfo.trim();
  const parts: string[] = [];
  if (input.devices.length) parts.push(`Devices: ${input.devices.join(", ")}`);
  if (input.browser?.trim()) parts.push(`Browser: ${input.browser.trim()}`);
  return parts.length ? parts.join(" | ") : undefined;
}

function mergedAttachmentUrls(data: CreateSubmissionInput): string[] {
  const fromNew = data.attachmentUrls ?? [];
  const fromLegacy = data.evidenceUrls ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...fromNew, ...fromLegacy]) {
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeUrlList(urls: string[] | undefined): string[] {
  if (!urls?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Short title for list views; full text stays in `description`. */
function feedbackTitleFromBody(feedback: string): string {
  const t = feedback.trim();
  if (t.length <= 120) return t;
  return `${t.slice(0, 117)}...`;
}

/** Core JSON fields for any submission response (list create, detail, etc.). */
function submissionToApiShape(s: Submission) {
  const base = {
    id: s.id,
    campaignId: s.campaignId,
    testerId: s.testerId,
    kind: s.kind,
    title: s.title,
    description: s.description,
    stepsToReproduce: s.stepsToReproduce,
    expectedBehavior: s.expectedBehavior,
    actualBehavior: s.actualBehavior,
    deviceInfo: s.deviceInfo,
    device: s.deviceInfo ?? undefined,
    devices: s.devices,
    browser: s.browser ?? undefined,
    additionalNotes: s.additionalNotes ?? undefined,
    attachmentUrls: s.evidenceUrls,
    videoLink: s.videoUrl ?? undefined,
    links: s.resourceLinks,
    severity: s.severity,
    rejectionText: s.rejectionText,
    allocatedAmount: dec(s.allocatedAmount),
    payoutAmount: dec(s.payoutAmount),
    submittedAt: s.submittedAt.toISOString(),
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    expiresAt: s.expiresAt?.toISOString() ?? null,
  };
  if (s.kind === SubmissionKind.feedback) {
    return { ...base, feedback: s.description };
  }
  return base;
}

function mapSubmissionStatusUi(status: SubmissionStatus): string {
  return status === SubmissionStatus.in_review ? "in-review" : status;
}

/** UI/dashboard-shaped submission (status uses `in-review`; adds campaign title + earned). */
export function formatSubmissionForApi(
  s: Submission & { campaign: Pick<Campaign, "id" | "title" | "clientId"> },
) {
  const earned =
    s.status === SubmissionStatus.approved && s.payoutAmount
      ? Number(dec(s.payoutAmount))
      : undefined;
  return {
    ...submissionToApiShape(s),
    status: mapSubmissionStatusUi(s.status),
    campaign: s.campaign.title,
    campaignTitle: s.campaign.title,
    earned,
    lastUpdated: s.updatedAt.toISOString(),
  };
}

const submissionDetailInclude = {
  campaign: true,
  tester: {
    select: {
      id: true,
      displayName: true,
      walletAddress: true,
      role: true,
    },
  },
  comments: {
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: {
          id: true,
          displayName: true,
          walletAddress: true,
          role: true,
        },
      },
    },
  },
  logs: {
    orderBy: { createdAt: "asc" },
    include: {
      actor: {
        select: {
          id: true,
          displayName: true,
          walletAddress: true,
          role: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionInclude;

type SubmissionDetailRow = Prisma.SubmissionGetPayload<{
  include: typeof submissionDetailInclude;
}>;

function displayNameForUser(u: {
  displayName: string | null;
  walletAddress: string;
}): string {
  const n = u.displayName?.trim();
  if (n) return n;
  const w = u.walletAddress;
  if (w.length <= 12) return w;
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

type SubmissionActivityApi = {
  id: string;
  type: "created" | "status-changed" | "approved" | "rejected" | "updated";
  title: string;
  description: string;
  timestamp: string;
  actor?: { name: string; role: "tester" | "client" };
  metadata?: Record<string, unknown>;
};

function mapSubmissionLogsToActivities(
  logs: SubmissionDetailRow["logs"],
  submissionTitle: string,
): SubmissionActivityApi[] {
  const out: SubmissionActivityApi[] = [];
  for (const log of logs) {
    const ts = log.createdAt.toISOString();
    const actor =
      log.actor != null
        ? {
            name: displayNameForUser(log.actor),
            role:
              log.actor.role === UserRole.client
                ? ("client" as const)
                : ("tester" as const),
          }
        : undefined;

    switch (log.eventType) {
      case "submission_created":
        out.push({
          id: log.id,
          type: "created",
          title: "Submission created",
          description: `Bug report "${submissionTitle}" was submitted`,
          timestamp: ts,
          actor,
        });
        break;
      case "status_changed": {
        const meta = (log.metadata ?? {}) as { from?: string; to?: string };
        const to = meta.to ?? "";
        const from = meta.from ?? "";
        if (to === "in-review") {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Status changed to In Review",
            description: "Client opened this submission for review",
            timestamp: ts,
            actor,
            metadata: { oldStatus: from, newStatus: "in-review" },
          });
        } else if (to === "approved") {
          out.push({
            id: log.id,
            type: "approved",
            title: "Submission approved",
            description: "The submission was approved",
            timestamp: ts,
            actor,
          });
        } else if (to === "rejected") {
          out.push({
            id: log.id,
            type: "rejected",
            title: "Submission rejected",
            description: "The submission was rejected",
            timestamp: ts,
            actor,
          });
        } else if (to === "disputed") {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Submission disputed",
            description: "The submission was disputed",
            timestamp: ts,
            actor,
            metadata: { oldStatus: from, newStatus: "disputed" },
          });
        } else {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Status updated",
            description: `Status changed from ${from} to ${to}`,
            timestamp: ts,
            actor,
            metadata: { oldStatus: from, newStatus: to },
          });
        }
        break;
      }
      case "severity_changed":
        out.push({
          id: log.id,
          type: "updated",
          title: "Severity updated",
          description: "Severity was changed for this submission",
          timestamp: ts,
          actor,
        });
        break;
      case "comment_added":
        out.push({
          id: log.id,
          type: "updated",
          title: "Comment added",
          description: "A new comment was posted",
          timestamp: ts,
          actor,
        });
        break;
      case "payout_initiated":
        out.push({
          id: log.id,
          type: "approved",
          title: "Payout initiated",
          description: "Payout processing started",
          timestamp: ts,
          actor,
        });
        break;
      default:
        out.push({
          id: log.id,
          type: "updated",
          title: log.eventType.replace(/_/g, " "),
          description: "Activity recorded",
          timestamp: ts,
          actor,
        });
    }
  }
  return out;
}

/** Full submission payload for detail views (`GET /submissions/:id`, client campaign submission detail). */
export function formatSubmissionDetailForApi(s: SubmissionDetailRow) {
  const earned =
    s.status === SubmissionStatus.approved && s.payoutAmount
      ? Number(dec(s.payoutAmount))
      : undefined;

  const comments = s.comments.map((c) => {
    const authorName = displayNameForUser(c.author);
    const authorRole =
      c.author.role === UserRole.client ? ("client" as const) : ("tester" as const);
    return {
      id: c.id,
      authorId: c.authorId,
      parentId: c.parentId,
      body: c.body,
      content: c.body,
      createdAt: c.createdAt.toISOString(),
      authorName,
      authorRole,
    };
  });

  const activities = mapSubmissionLogsToActivities(s.logs, s.title);

  return {
    ...submissionToApiShape(s),
    status: mapSubmissionStatusUi(s.status),
    rejectionMessage: s.rejectionText,
    lastUpdated: s.updatedAt.toISOString(),
    campaign: s.campaign.title,
    campaignTitle: s.campaign.title,
    campaignVisibility: s.campaign.visibility,
    campaignListed: s.campaign.listed,
    earned,
    submittedBy: {
      id: s.tester.id,
      displayName: displayNameForUser(s.tester),
    },
    comments,
    activities,
  };
}

const submissionListInclude = {
  campaign: {
    include: {
      client: { include: { clientProfile: true } },
    },
  },
} as const;

type SubmissionListRow = Prisma.SubmissionGetPayload<{
  include: typeof submissionListInclude;
}>;

function submissionToListItem(s: SubmissionListRow) {
  const earned =
    s.status === SubmissionStatus.approved && s.payoutAmount
      ? Number(dec(s.payoutAmount))
      : undefined;
  return {
    id: s.id,
    title: s.title,
    severity: s.severity,
    status: mapSubmissionStatusUi(s.status),
    kind: s.kind,
    campaignId: s.campaignId,
    testerId: s.testerId,
    campaign: s.campaign.title,
    campaignTitle: s.campaign.title,
    description: s.description,
    submittedAt: s.submittedAt.toISOString(),
    lastUpdated: s.updatedAt.toISOString(),
    earned,
  };
}

export async function listSubmissions(
  viewer: ViewerContext,
  query: ListSubmissionsQueryDto,
) {
  const { campaignId, mine, limit, page, status } = query;
  const offset = pageToOffset(page, limit);
  const statusFilter = status ? { status } : {};

  if (mine === "true") {
    if (viewer.role !== UserRole.tester) {
      throw new ForbiddenError("mine=true requires tester role");
    }
    const where: Prisma.SubmissionWhereInput = {
      testerId: viewer.userId,
      ...(campaignId ? { campaignId } : {}),
      ...statusFilter,
    };
    const [rows, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        include: submissionListInclude,
        orderBy: { submittedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.submission.count({ where }),
    ]);
    return {
      submissions: rows.map(submissionToListItem),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  if (viewer.role !== UserRole.client) {
    throw new ForbiddenError("Client role required for listing without mine=true");
  }

  const where: Prisma.SubmissionWhereInput = {
    campaign: campaignId
      ? { id: campaignId, clientId: viewer.userId }
      : { clientId: viewer.userId },
    ...statusFilter,
  };

  const [rows, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: submissionListInclude,
      orderBy: { submittedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.submission.count({ where }),
  ]);

  return {
    submissions: rows.map(submissionToListItem),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function createSubmission(
  testerId: string,
  data: CreateSubmissionInput,
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: data.campaignId },
  });
  if (!campaign) throw new NotFoundError("Campaign not found");
  if (campaign.status !== CampaignStatus.active) {
    const msg =
      campaign.status === CampaignStatus.paused
        ? "Campaign is paused and is not accepting submissions"
        : campaign.status === CampaignStatus.ended
          ? "Campaign has ended and is not accepting submissions"
          : campaign.status === CampaignStatus.draft
            ? "Campaign is not yet accepting submissions"
            : "Campaign is not accepting submissions";
    throw new ValidationError(msg);
  }
  if (!campaign.escrowPda) {
    throw new ValidationError("Campaign escrow not initialized");
  }

  const allocationSeverity: SubmissionSeverity =
    data.kind === "feedback" ? SubmissionSeverity.mild : data.severity;

  const allocation = midpointForSeverity(allocationSeverity, campaign.severityRewards);
  if (campaign.availableBalance.lt(allocation)) {
    throw new ValidationError(
      "Insufficient available balance for this allocation (campaign may need top-up)",
    );
  }

  const reviewDays = campaign.reviewWindowDays ?? 7;
  const submittedAt = new Date();
  const expiresAt = new Date(
    submittedAt.getTime() + reviewDays * 24 * 60 * 60 * 1000,
  );

  const allocateTx = stubTxSignature("allocate");
  const attachmentUrls = mergedAttachmentUrls(data);
  const resourceLinks = normalizeUrlList(data.links);

  const result = await prisma.$transaction(async (tx) => {
    const sub =
      data.kind === "feedback"
        ? await tx.submission.create({
            data: {
              campaignId: data.campaignId,
              testerId,
              kind: SubmissionKind.feedback,
              title: feedbackTitleFromBody(data.feedback),
              description: data.feedback.trim(),
              stepsToReproduce: "",
              expectedBehavior: null,
              actualBehavior: null,
              devices: [],
              browser: null,
              additionalNotes: null,
              videoUrl: null,
              deviceInfo: undefined,
              severity: SubmissionSeverity.mild,
              status: SubmissionStatus.submitted,
              allocatedAmount: allocation,
              evidenceUrls: attachmentUrls,
              resourceLinks,
              expiresAt,
            },
          })
        : await tx.submission.create({
            data: {
              campaignId: data.campaignId,
              testerId,
              kind: SubmissionKind.bug,
              title: data.title,
              description: data.description,
              stepsToReproduce: data.stepsToReproduce,
              expectedBehavior: data.expectedBehavior?.trim() || null,
              actualBehavior: data.actualBehavior?.trim() || null,
              devices: data.devices,
              browser: data.browser?.trim() || null,
              additionalNotes: data.additionalNotes?.trim() || null,
              videoUrl: data.videoLink?.trim() || null,
              deviceInfo: buildDeviceInfo({
                devices: data.devices,
                browser: data.browser,
                deviceInfo: data.deviceInfo,
              }),
              severity: data.severity,
              status: SubmissionStatus.submitted,
              allocatedAmount: allocation,
              evidenceUrls: attachmentUrls,
              resourceLinks,
              expiresAt,
            },
          });

    await tx.submissionLog.create({
      data: {
        submissionId: sub.id,
        actorId: testerId,
        eventType: "submission_created",
        metadata: { pendingAllocateTx: allocateTx },
      },
    });

    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        availableBalance: campaign.availableBalance.minus(allocation),
        allocatedBalance: campaign.allocatedBalance.plus(allocation),
      },
    });

    return sub;
  });

  const withCampaign = await prisma.submission.findUniqueOrThrow({
    where: { id: result.id },
    include: { campaign: true },
  });

  return {
    submission: formatSubmissionForApi(withCampaign),
    chain: {
      pendingProgramConfirmation: true,
      allocateTx,
    },
  };
}

export async function getSubmissionForUser(
  submissionId: string,
  viewer: ViewerContext,
  options?: { openAsClient?: boolean },
) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: submissionDetailInclude,
  });
  if (!s) throw new NotFoundError("Submission not found");

  const isTester =
    viewer.role === UserRole.tester && s.testerId === viewer.userId;
  const isClient =
    viewer.role === UserRole.client && s.campaign.clientId === viewer.userId;

  if (!isTester && !isClient) {
    throw new ForbiddenError("Cannot access this submission");
  }

  if (
    options?.openAsClient &&
    isClient &&
    s.status === SubmissionStatus.submitted
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.in_review },
      });
      await tx.submissionLog.create({
        data: {
          submissionId,
          actorId: viewer.userId,
          eventType: "status_changed",
          metadata: { from: "submitted", to: "in-review" },
        },
      });
    });
    const full = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: submissionDetailInclude,
    });
    return {
      submission: formatSubmissionDetailForApi(full),
      transitionedToInReview: true,
    };
  }

  return {
    submission: formatSubmissionDetailForApi(s),
    transitionedToInReview: false,
  };
}

export async function patchSubmissionSeverity(
  submissionId: string,
  clientId: string,
  severity?: SubmissionSeverity,
) {
  if (!severity) throw new ValidationError("severity required");
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.campaign.clientId !== clientId) throw new ForbiddenError();

  const newAlloc = midpointForSeverity(severity, s.campaign.severityRewards);
  const delta = newAlloc.minus(s.allocatedAmount);

  await prisma.$transaction(async (tx) => {
    if (!delta.equals(0)) {
      await tx.campaign.update({
        where: { id: s.campaignId },
        data: {
          availableBalance: s.campaign.availableBalance.minus(delta),
          allocatedBalance: s.campaign.allocatedBalance.plus(delta),
        },
      });
    }

    await tx.submission.update({
      where: { id: submissionId },
      data: { severity, allocatedAmount: newAlloc },
    });

    await tx.submissionLog.create({
      data: {
        submissionId,
        actorId: clientId,
        eventType: "severity_changed",
        metadata: { severity },
      },
    });
  });

  const full = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { campaign: true },
  });
  return formatSubmissionForApi(full);
}

export async function addComment(
  submissionId: string,
  authorId: string,
  body: string,
  parentId?: string,
) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.testerId !== authorId && s.campaign.clientId !== authorId) {
    throw new ForbiddenError("Only the tester or campaign client can comment");
  }

  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.submissionComment.create({
      data: { submissionId, authorId, body, parentId },
    });
    await tx.submissionLog.create({
      data: {
        submissionId,
        actorId: authorId,
        eventType: "comment_added",
        metadata: { comment_id: c.id },
      },
    });
    return c;
  });

  return comment;
}

export async function approveSubmission(
  submissionId: string,
  clientId: string,
  input?: ApproveSubmissionInput,
) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.campaign.clientId !== clientId) throw new ForbiddenError();
  if (
    s.status !== SubmissionStatus.submitted &&
    s.status !== SubmissionStatus.in_review
  ) {
    throw new ValidationError("Submission cannot be approved in this status");
  }

  const lock = s.allocatedAmount;
  let gross: Prisma.Decimal;
  if (input?.grossUsdc != null) {
    gross = toDecimal(input.grossUsdc);
  } else if (input?.severity) {
    gross = midpointForSeverity(input.severity, s.campaign.severityRewards);
  } else {
    gross = s.allocatedAmount;
  }

  const testerShare = gross.times(0.85);
  const platformShare = gross.times(0.15);
  const txSig = stubTxSignature("approve");

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.approved,
        reviewedAt: new Date(),
        payoutAmount: gross,
        severity: input?.severity ?? s.severity,
      },
    });

    await tx.payout.create({
      data: {
        submissionId,
        testerId: s.testerId,
        campaignId: s.campaignId,
        grossAmount: gross,
        testerAmount: testerShare,
        platformFee: platformShare,
        txSignature: txSig,
        status: PayoutStatus.completed,
        paidAt: new Date(),
      },
    });

    await tx.campaign.update({
      where: { id: s.campaignId },
      data: {
        allocatedBalance: s.campaign.allocatedBalance.minus(lock),
        budgetRemaining: s.campaign.budgetRemaining.minus(gross),
        availableBalance: s.campaign.availableBalance.plus(lock.minus(gross)),
      },
    });

    await tx.submissionLog.create({
      data: {
        submissionId,
        actorId: clientId,
        eventType: "payout_initiated",
        metadata: { tx: txSig, gross: gross.toString() },
      },
    });
  });

  return {
    payoutTx: txSig,
    grossAmount: gross.toString(),
    testerAmount: testerShare.toString(),
    platformFee: platformShare.toString(),
    chain: { pendingProgramConfirmation: true },
  };
}

export async function rejectSubmission(
  submissionId: string,
  clientId: string,
  input: RejectSubmissionInput,
) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.campaign.clientId !== clientId) throw new ForbiddenError();
  if (
    s.status !== SubmissionStatus.submitted &&
    s.status !== SubmissionStatus.in_review
  ) {
    throw new ValidationError("Submission cannot be rejected in this status");
  }

  const txSig = input.rejectTxSignature ?? stubTxSignature("reject");

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.rejected,
        reviewedAt: new Date(),
        rejectionText: input.rejectionText,
      },
    });

    await tx.campaign.update({
      where: { id: s.campaignId },
      data: {
        availableBalance: s.campaign.availableBalance.plus(s.allocatedAmount),
        allocatedBalance: s.campaign.allocatedBalance.minus(s.allocatedAmount),
      },
    });

    await tx.submissionLog.create({
      data: {
        submissionId,
        actorId: clientId,
        eventType: "status_changed",
        metadata: { from: s.status, to: "rejected", rejectTx: txSig },
      },
    });
  });

  return {
    rejectTx: txSig,
    chain: { pendingProgramConfirmation: true },
  };
}
