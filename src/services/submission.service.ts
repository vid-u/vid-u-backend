import {
  CampaignStatus,
  PayoutStatus,
  SubmissionKind,
  SubmissionSeverity,
  SubmissionStatus,
  UserRole,
} from "../generated/prisma/enums.js";
import { randomUUID } from "node:crypto";
import type { Campaign, Submission } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { solanaBackendConfigured, solanaRpcConfigured } from "../lib/solana/config.js";
import {
  allocateSubmissionOnChain,
  fetchSubmissionAllocationOnChain,
  reallocateSubmissionOnChain,
  rejectSubmissionOnChain,
} from "../lib/solana/escrow.js";
import { usdcToRawAmount } from "../lib/solana/amounts.js";
import { submissionEscrowPdaBase58 } from "../lib/solana/pdas.js";
import { retryWithBackoff } from "../lib/solana/retry.js";
import { verifyAllocateSubmissionTx } from "../lib/solana/verify-campaign-tx.js";
import {
  verifyApproveSubmissionTx,
  verifyRejectSubmissionTx,
} from "../lib/solana/verify-tx.js";
import { dec, prisma } from "../lib/prisma.js";
import { buildPaginationMeta, pageToOffset } from "../utils/api-response.js";
import type { SeverityRewards } from "../types/campaign.types.js";
import type {
  ApproveSubmissionInput,
  CreateSubmissionInput,
  PatchTesterSubmissionEvidenceInput,
  RejectSubmissionInput,
} from "../types/submission.types.js";
import type { ListSubmissionsQueryDto } from "../validation/submission.schema.js";
import type { ViewerContext } from "../types/viewer.types.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";

function toDecimal(v: number | string): Prisma.Decimal {
  return new Prisma.Decimal(typeof v === "number" ? String(v) : v);
}

/** `submission_logs.metadata` — `txSignatures` groups on-chain txs for escrow actions. */
function submissionLogMetadata(
  fields: Record<string, unknown>,
  txSignatures?: Partial<{
    allocate: string;
    reallocate: string;
    approve: string;
    reject: string;
  }>,
): Prisma.InputJsonValue {
  const sig: Record<string, string> = {};
  if (txSignatures?.allocate?.trim()) sig.allocate = txSignatures.allocate.trim();
  if (txSignatures?.reallocate?.trim()) sig.reallocate = txSignatures.reallocate.trim();
  if (txSignatures?.approve?.trim()) sig.approve = txSignatures.approve.trim();
  if (txSignatures?.reject?.trim()) sig.reject = txSignatures.reject.trim();
  const out: Record<string, unknown> = { ...fields };
  if (Object.keys(sig).length) out.txSignatures = sig;
  return out as Prisma.InputJsonValue;
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

function assertEvidenceObjectKeysForSubmission(
  campaignId: string,
  submissionId: string,
  keys: string[],
): void {
  const prefix = `campaigns/${campaignId}/submissions/${submissionId}/`;
  for (const raw of keys) {
    const k = raw.trim();
    if (!k || k.includes("..") || k.startsWith("/")) {
      throw new ValidationError("Invalid attachment object key");
    }
    if (!k.startsWith(prefix) || k.length <= prefix.length) {
      throw new ValidationError("Attachment keys must belong to this submission upload path");
    }
    const rest = k.slice(prefix.length);
    if (rest.includes("/")) {
      throw new ValidationError("Invalid attachment object key");
    }
  }
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
    submissionEscrowPda: s.submissionEscrowPda ?? null,
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

/** Amount shown to testers as "earned" — net of platform fee (`payouts.testerAmount`). */
function testerEarnedUsdc(
  s: Pick<Submission, "status" | "payoutAmount"> & {
    payouts?: { testerAmount: Prisma.Decimal | null; txSignature?: string }[];
  },
): number | undefined {
  if (s.status !== SubmissionStatus.approved) return undefined;
  const net = s.payouts?.[0]?.testerAmount;
  if (net != null) return Number(dec(net));
  if (s.payoutAmount != null) return Number(dec(s.payoutAmount)) * 0.85;
  return undefined;
}

const submissionPayoutNetInclude = {
  where: { status: PayoutStatus.completed },
  orderBy: { paidAt: "desc" as const },
  take: 1,
  select: { testerAmount: true, txSignature: true },
};

/** UI/dashboard-shaped submission (status uses `in-review`; adds campaign title + earned). */
export function formatSubmissionForApi(
  s: Submission & {
    campaign: Pick<Campaign, "id" | "title" | "clientId">;
    payouts?: { testerAmount: Prisma.Decimal | null; txSignature: string }[];
  },
) {
  const earned = testerEarnedUsdc(s);
  const payoutTxSignature = s.payouts?.[0]?.txSignature;
  return {
    ...submissionToApiShape(s),
    status: mapSubmissionStatusUi(s.status),
    campaign: s.campaign.title,
    campaignTitle: s.campaign.title,
    earned,
    ...(payoutTxSignature ? { payoutTxSignature } : {}),
    lastUpdated: s.updatedAt.toISOString(),
  };
}

const submissionDetailInclude = {
  campaign: true,
  payouts: submissionPayoutNetInclude,
  tester: {
    select: {
      id: true,
      displayName: true,
      walletAddress: true,
      role: true,
      avatarUrl: true,
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
          avatarUrl: true,
          clientProfile: { select: { logoUrl: true } },
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

function authorAvatarUrlForApi(author: {
  role: UserRole;
  avatarUrl: string | null;
  clientProfile: { logoUrl: string | null } | null;
}): string | null {
  if (author.role === UserRole.client) {
    const logo = author.clientProfile?.logoUrl?.trim();
    return logo || null;
  }
  const av = author.avatarUrl?.trim();
  return av || null;
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

/** Merge DB `log.metadata` (e.g. `txSignatures`) with UI-friendly fields. */
function mergeActivityMetadata(
  log: { metadata: unknown },
  extras: Record<string, unknown>,
): { metadata: Record<string, unknown> } {
  const base =
    log.metadata !== null && typeof log.metadata === "object" && !Array.isArray(log.metadata)
      ? { ...(log.metadata as Record<string, unknown>) }
      : {};
  return { metadata: { ...base, ...extras } };
}

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
          ...mergeActivityMetadata(log, {}),
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
            ...mergeActivityMetadata(log, { oldStatus: from, newStatus: "in-review" }),
          });
        } else if (to === "approved") {
          out.push({
            id: log.id,
            type: "approved",
            title: "Submission approved",
            description: "The submission was approved",
            timestamp: ts,
            actor,
            ...mergeActivityMetadata(log, {}),
          });
        } else if (to === "rejected") {
          out.push({
            id: log.id,
            type: "rejected",
            title: "Submission rejected",
            description: "The submission was rejected",
            timestamp: ts,
            actor,
            ...mergeActivityMetadata(log, {}),
          });
        } else if (to === "triaged") {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Status changed to Triaged",
            description: "Client commented or updated this submission",
            timestamp: ts,
            actor,
            ...mergeActivityMetadata(log, { oldStatus: from, newStatus: "triaged" }),
          });
        } else if (to === "disputed") {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Submission disputed",
            description: "The submission was disputed",
            timestamp: ts,
            actor,
            ...mergeActivityMetadata(log, { oldStatus: from, newStatus: "disputed" }),
          });
        } else {
          out.push({
            id: log.id,
            type: "status-changed",
            title: "Status updated",
            description: `Status changed from ${from} to ${to}`,
            timestamp: ts,
            actor,
            ...mergeActivityMetadata(log, { oldStatus: from, newStatus: to }),
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
          ...mergeActivityMetadata(log, {}),
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
          ...mergeActivityMetadata(log, {}),
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
          ...mergeActivityMetadata(log, {}),
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
          ...mergeActivityMetadata(log, {}),
        });
    }
  }
  return out;
}

/** Full submission payload for detail views (`GET /submissions/:id`, client campaign submission detail). */
export function formatSubmissionDetailForApi(s: SubmissionDetailRow) {
  const earned = testerEarnedUsdc(s);

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
      authorAvatarUrl: authorAvatarUrlForApi(c.author),
    };
  });

  const activities = mapSubmissionLogsToActivities(s.logs, s.title);

  const payoutTxSignature = s.payouts?.[0]?.txSignature;

  return {
    ...submissionToApiShape(s),
    status: mapSubmissionStatusUi(s.status),
    rejectionMessage: s.rejectionText,
    lastUpdated: s.updatedAt.toISOString(),
    campaign: s.campaign.title,
    campaignTitle: s.campaign.title,
    campaignVisibility: s.campaign.visibility,
    campaignListed: s.campaign.listed,
    campaignEscrowPda: s.campaign.escrowPda,
    ...(payoutTxSignature ? { payoutTxSignature } : {}),
    earned,
    submittedBy: {
      id: s.tester.id,
      displayName: displayNameForUser(s.tester),
      walletAddress: s.tester.walletAddress,
      avatarUrl: s.tester.avatarUrl?.trim() ? s.tester.avatarUrl.trim() : null,
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
  payouts: submissionPayoutNetInclude,
  tester: {
    select: {
      id: true,
      displayName: true,
      walletAddress: true,
      avatarUrl: true,
    },
  },
} as const;

type SubmissionListRow = Prisma.SubmissionGetPayload<{
  include: typeof submissionListInclude;
}>;

function submissionToListItem(s: SubmissionListRow) {
  const earned = testerEarnedUsdc(s);
  const payoutTxSignature = s.payouts?.[0]?.txSignature;
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
    ...(payoutTxSignature ? { payoutTxSignature } : {}),
    submittedBy: {
      id: s.tester.id,
      displayName: displayNameForUser(s.tester),
      avatarUrl: s.tester.avatarUrl?.trim() ? s.tester.avatarUrl.trim() : null,
    },
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

  const tester = await prisma.user.findUnique({
    where: { id: testerId },
    select: { walletAddress: true },
  });
  if (!tester?.walletAddress?.trim()) {
    throw new ValidationError("Tester profile must have a Solana wallet address before submitting");
  }
  const testerWallet = tester.walletAddress.trim();

  const chainRecovery =
    "chainRecovery" in data && data.chainRecovery ? data.chainRecovery : undefined;

  if (!chainRecovery && !solanaBackendConfigured()) {
    throw new ValidationError(
      "Solana backend is not configured. Set SOLANA_RPC_URL, BUGHYVE_PROGRAM_ID (or rely on bundled IDL), and BACKEND_AUTHORITY_SECRET for allocate_submission.",
    );
  }

  let submissionId: string;
  let allocateTx: string;

  if (chainRecovery) {
    if (!solanaRpcConfigured()) {
      throw new ValidationError("SOLANA_RPC_URL is required to verify chainRecovery.");
    }
    try {
      await verifyAllocateSubmissionTx(chainRecovery.allocateTxSignature, {
        campaignUuid: data.campaignId,
        submissionUuid: chainRecovery.submissionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Recovery verification failed";
      throw new ValidationError(msg);
    }

    const chainLock = await fetchSubmissionAllocationOnChain({
      campaignUuid: data.campaignId,
      submissionUuid: chainRecovery.submissionId,
    });
    const expectedRaw = usdcToRawAmount(allocation);
    if (
      !chainLock ||
      !chainLock.allocatedAmountRaw.eq(expectedRaw) ||
      chainLock.status !== 0
    ) {
      throw new ValidationError(
        "On-chain allocation for this submission does not match the expected amount; refresh and retry.",
      );
    }

    const existing = await prisma.submission.findUnique({
      where: { id: chainRecovery.submissionId },
      include: { campaign: true },
    });
    if (existing) {
      if (existing.testerId !== testerId || existing.campaignId !== data.campaignId) {
        throw new ForbiddenError();
      }
      if (!existing.submissionEscrowPda) {
        await prisma.submission.update({
          where: { id: existing.id },
          data: {
            submissionEscrowPda: submissionEscrowPdaBase58(
              data.campaignId,
              chainRecovery.submissionId,
            ),
          },
        });
      }
      return {
        submission: formatSubmissionForApi(
          await prisma.submission.findUniqueOrThrow({
            where: { id: existing.id },
            include: { campaign: true },
          }),
        ),
        chain: {
          pendingProgramConfirmation: false,
          allocateTx: chainRecovery.allocateTxSignature,
          idempotent: true,
        },
      };
    }

    submissionId = chainRecovery.submissionId;
    allocateTx = chainRecovery.allocateTxSignature;
  } else {
    submissionId = randomUUID();
    try {
      allocateTx = await allocateSubmissionOnChain({
        campaignUuid: data.campaignId,
        submissionUuid: submissionId,
        testerWalletBase58: testerWallet,
        allocationUsdc: allocation,
        expiresAt,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "On-chain allocation failed";
      throw new ValidationError(msg);
    }
  }

  const submissionEscrowPda = submissionEscrowPdaBase58(data.campaignId, submissionId);

  const attachmentUrls = mergedAttachmentUrls(data);
  const resourceLinks = normalizeUrlList(data.links);

  let result;
  try {
    result = await retryWithBackoff(() =>
      prisma.$transaction(async (tx) => {
        const c = await tx.campaign.findUniqueOrThrow({ where: { id: data.campaignId } });
        if (c.availableBalance.lt(allocation)) {
          throw new ValidationError(
            "Insufficient available balance for this allocation (campaign may need top-up)",
          );
        }

        const sub =
          data.kind === "feedback"
            ? await tx.submission.create({
                data: {
                  id: submissionId,
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
                  submissionEscrowPda,
                  evidenceUrls: attachmentUrls,
                  resourceLinks,
                  expiresAt,
                },
              })
            : await tx.submission.create({
                data: {
                  id: submissionId,
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
                  submissionEscrowPda,
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
            metadata: submissionLogMetadata({}, { allocate: allocateTx }),
          },
        });

        await tx.campaign.update({
          where: { id: c.id },
          data: {
            availableBalance: c.availableBalance.minus(allocation),
            allocatedBalance: c.allocatedBalance.plus(allocation),
          },
        });

        return sub;
      }),
    );
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ForbiddenError) throw e;
    if (
      chainRecovery &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const row = await prisma.submission.findUnique({
        where: { id: chainRecovery.submissionId },
        include: { campaign: true },
      });
      if (row && row.testerId === testerId && row.campaignId === data.campaignId) {
        return {
          submission: formatSubmissionForApi(row),
          chain: {
            pendingProgramConfirmation: false,
            allocateTx: chainRecovery.allocateTxSignature,
            idempotent: true,
          },
        };
      }
    }
    if (!chainRecovery) {
      throw new ConflictError(
        "allocate_submission succeeded but persistence failed. Retry the same request with chainRecovery set to { submissionId, allocateTxSignature } using the ids from this payload.",
        {
          code: "ALLOCATE_OK_DB_FAILED",
          submissionId,
          allocateTx,
        },
      );
    }
    throw e;
  }

  const withCampaign = await prisma.submission.findUniqueOrThrow({
    where: { id: result.id },
    include: { campaign: true },
  });

  return {
    submission: formatSubmissionForApi(withCampaign),
    chain: {
      pendingProgramConfirmation: false,
      allocateTx,
      recovery: Boolean(chainRecovery),
    },
  };
}

/** Tester — persist evidence keys after presigned uploads to `campaigns/.../submissions/:id/…`. */
export async function patchSubmissionEvidenceUrls(
  testerId: string,
  submissionId: string,
  data: PatchTesterSubmissionEvidenceInput,
) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!sub) throw new NotFoundError("Submission not found");
  if (sub.testerId !== testerId) throw new ForbiddenError("Not your submission");
  if (sub.status !== SubmissionStatus.submitted) {
    throw new ValidationError("Evidence can only be attached while the submission is submitted");
  }
  if (sub.evidenceUrls.length > 0) {
    throw new ValidationError("Evidence is already attached to this submission");
  }

  const seen = new Set<string>();
  const attachmentUrls: string[] = [];
  for (const u of data.attachmentUrls) {
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    attachmentUrls.push(t);
  }
  if (attachmentUrls.length === 0) {
    throw new ValidationError("attachmentUrls must not be empty");
  }
  assertEvidenceObjectKeysForSubmission(sub.campaignId, submissionId, attachmentUrls);

  await prisma.submission.update({
    where: { id: submissionId },
    data: { evidenceUrls: attachmentUrls },
  });

  const withCampaign = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { campaign: true },
  });

  return { submission: formatSubmissionForApi(withCampaign) };
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

  if (!delta.equals(0) && s.campaign.escrowPda?.trim() && !solanaBackendConfigured()) {
    throw new ValidationError(
      "This campaign uses on-chain escrow; configure the Solana backend (RPC + authority key) to change severity and keep the vault in sync.",
    );
  }

  let reallocateTx: string | undefined;
  if (solanaBackendConfigured() && !delta.equals(0)) {
    reallocateTx = await reallocateSubmissionOnChain({
      campaignUuid: s.campaign.id,
      submissionUuid: s.id,
      expectedCurrentUsdc: s.allocatedAmount,
      newAllocationUsdc: newAlloc,
    });
  }

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

    const moveToTriaged = s.status === SubmissionStatus.in_review;

    await tx.submission.update({
      where: { id: submissionId },
      data: {
        severity,
        ...(!delta.equals(0) ? { allocatedAmount: newAlloc } : {}),
        ...(moveToTriaged ? { status: SubmissionStatus.triaged } : {}),
      },
    });

    if (moveToTriaged) {
      await tx.submissionLog.create({
        data: {
          submissionId,
          actorId: clientId,
          eventType: "status_changed",
          metadata: { from: "in-review", to: "triaged" },
        },
      });
    }

    await tx.submissionLog.create({
      data: {
        submissionId,
        actorId: clientId,
        eventType: "severity_changed",
        metadata: submissionLogMetadata(
          {
            severity,
            previousAllocated: s.allocatedAmount.toString(),
            newAllocated: newAlloc.toString(),
          },
          reallocateTx ? { reallocate: reallocateTx } : {},
        ),
      },
    });
  });

  const full = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: {
      campaign: true,
      payouts: submissionPayoutNetInclude,
    },
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

  const isClient = authorId === s.campaign.clientId;
  const moveToTriaged = isClient && s.status === SubmissionStatus.in_review;

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
    const now = new Date();
    await tx.submission.update({
      where: { id: submissionId },
      data: moveToTriaged
        ? { status: SubmissionStatus.triaged, updatedAt: now }
        : { updatedAt: now },
    });
    if (moveToTriaged) {
      await tx.submissionLog.create({
        data: {
          submissionId,
          actorId: authorId,
          eventType: "status_changed",
          metadata: { from: "in-review", to: "triaged" },
        },
      });
    }
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
    s.status !== SubmissionStatus.in_review &&
    s.status !== SubmissionStatus.triaged
  ) {
    throw new ValidationError("Submission cannot be approved in this status");
  }

  const lock = s.allocatedAmount;
  let gross: Prisma.Decimal;
  let txSig: string;

  /** Escrow payout matches DB `allocatedAmount` (mirrors on-chain lock after allocate/reallocate). */
  gross = s.allocatedAmount;
  if (input?.grossUsdc != null && !gross.equals(toDecimal(input.grossUsdc))) {
    throw new ValidationError(
      "grossUsdc must match this submission's current allocated amount. Refresh the page after changing severity, or set the bounty field to the shown escrow amount.",
    );
  }

  if (!solanaRpcConfigured()) {
    throw new ValidationError("SOLANA_RPC_URL is required to verify approve_submission.");
  }
  const sig = input?.approveTxSignature?.trim();
  if (!sig) {
    throw new ValidationError(
      "approveTxSignature is required (the client must sign approve_submission on-chain).",
    );
  }
  try {
    await verifyApproveSubmissionTx(sig, {
      campaignUuid: s.campaignId,
      submissionUuid: submissionId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid approve transaction";
    throw new ValidationError(msg);
  }
  if (input?.severity && input.severity !== s.severity) {
    throw new ValidationError(
      "severity cannot differ from the submission when approving with a verified on-chain transaction",
    );
  }
  txSig = sig;

  const testerShare = gross.times(0.85);
  const platformShare = gross.times(0.15);

  await retryWithBackoff(() =>
    prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: SubmissionStatus.approved,
          reviewedAt: new Date(),
          payoutAmount: gross,
          severity: input?.severity ?? s.severity,
          allocatedAmount: new Prisma.Decimal(0),
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
          metadata: submissionLogMetadata({ gross: gross.toString() }, { approve: txSig }),
        },
      });
    }),
  );

  return {
    payoutTx: txSig,
    grossAmount: gross.toString(),
    testerAmount: testerShare.toString(),
    platformFee: platformShare.toString(),
    chain: { pendingProgramConfirmation: false },
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
    s.status !== SubmissionStatus.in_review &&
    s.status !== SubmissionStatus.triaged
  ) {
    throw new ValidationError("Submission cannot be rejected in this status");
  }

  let txSig: string;

  if (solanaBackendConfigured()) {
    try {
      txSig = await rejectSubmissionOnChain({
        campaignUuid: s.campaignId,
        submissionUuid: submissionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "On-chain reject failed";
      throw new ValidationError(msg);
    }
  } else if (input.rejectTxSignature?.trim()) {
    const sig = input.rejectTxSignature.trim();
    if (!solanaRpcConfigured()) {
      throw new ValidationError("SOLANA_RPC_URL is required to verify reject_submission.");
    }
    try {
      await verifyRejectSubmissionTx(sig, {
        campaignUuid: s.campaignId,
        submissionUuid: submissionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid reject transaction";
      throw new ValidationError(msg);
    }
    txSig = sig;
  } else {
    throw new ValidationError(
      "Configure BACKEND_AUTHORITY_SECRET and SOLANA_RPC_URL so the API can sign reject_submission with backend authority. (Optional rejectTxSignature is only for integrations without backend keys.)",
    );
  }

  await retryWithBackoff(() =>
    prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: SubmissionStatus.rejected,
          reviewedAt: new Date(),
          rejectionText: input.rejectionText,
          allocatedAmount: new Prisma.Decimal(0),
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
          metadata: submissionLogMetadata(
            { from: s.status, to: "rejected" },
            { reject: txSig },
          ),
        },
      });
    }),
  );

  return {
    rejectTx: txSig,
    chain: { pendingProgramConfirmation: false },
  };
}
