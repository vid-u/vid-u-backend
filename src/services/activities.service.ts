import { dec, prisma } from "../lib/prisma.js";
import { buildPaginationMeta, pageToOffset } from "../utils/api-response.js";
import type { CampaignActivityQueryRow } from "../types/activities.types.js";
import type { ViewerContext } from "../types/viewer.types.js";
import * as campaignService from "./campaign.service.js";

/**
 * Submission + completed payout timeline for one campaign.
 * Caller must have already authorized the viewer via `getCampaignForViewer`.
 */
export async function getCampaignActivities(
  campaignId: string,
  viewer: ViewerContext,
  page: number,
  limit: number,
) {
  await campaignService.getCampaignForViewer(campaignId, viewer);

  const offset = pageToOffset(page, limit);

  const [countResult] = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*)::bigint AS total FROM (
      SELECT s.id FROM submissions s
      WHERE s.campaign_id = ${campaignId}::uuid
      UNION ALL
      SELECT p.id FROM payouts p
      WHERE p.campaign_id = ${campaignId}::uuid
        AND p.paid_at IS NOT NULL
        AND p.status = 'completed'
    ) x
  `;
  const total = Number(countResult?.total ?? 0);

  const rows = await prisma.$queryRaw<CampaignActivityQueryRow[]>`
    (
      SELECT
        s.id::text AS id,
        'submission' AS activity_type,
        s.submitted_at AS occurred_at,
        s.campaign_id::text AS campaign_id,
        c.title AS campaign_title,
        s.tester_id::text AS user_id,
        u.display_name,
        u.wallet_address,
        u.avatar_url,
        s.title AS submission_title,
        s.kind::text AS submission_kind,
        NULL::decimal AS amount_usdc
      FROM submissions s
      INNER JOIN campaigns c ON c.id = s.campaign_id
      INNER JOIN users u ON u.id = s.tester_id
      WHERE s.campaign_id = ${campaignId}::uuid
    )
    UNION ALL
    (
      SELECT
        p.id::text AS id,
        'payout' AS activity_type,
        p.paid_at AS occurred_at,
        p.campaign_id::text AS campaign_id,
        c.title AS campaign_title,
        p.tester_id::text AS user_id,
        u.display_name,
        u.wallet_address,
        u.avatar_url,
        sub2.title AS submission_title,
        'payout' AS submission_kind,
        p.tester_amount AS amount_usdc
      FROM payouts p
      INNER JOIN campaigns c ON c.id = p.campaign_id
      INNER JOIN users u ON u.id = p.tester_id
      INNER JOIN submissions sub2 ON sub2.id = p.submission_id
      WHERE p.campaign_id = ${campaignId}::uuid
        AND p.paid_at IS NOT NULL
        AND p.status = 'completed'
    )
    ORDER BY occurred_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const activities = rows.map((r) => {
    const base = {
      id: r.id,
      type: r.activity_type as "submission" | "payout",
      occurredAt: r.occurred_at.toISOString(),
      campaignId: r.campaign_id,
      campaignTitle: r.campaign_title,
      user: {
        id: r.user_id,
        displayName: r.display_name,
        walletAddress: r.wallet_address,
        avatarUrl: r.avatar_url,
      },
    };
    if (r.activity_type === "submission") {
      return {
        ...base,
        submission: {
          id: r.id,
          kind: r.submission_kind as "bug" | "feedback",
        },
      };
    }
    return {
      ...base,
      payout: {
        id: r.id,
        amountUsdc: r.amount_usdc ? Number(dec(r.amount_usdc)) : 0,
        submissionTitle: r.submission_title ?? "",
      },
    };
  });

  return {
    activities,
    meta: buildPaginationMeta(page, limit, total),
  };
}
