# Testing real refund disbursement (Xendit test mode)

Guide for exercising **Refund Balance** with a real Xendit payout (`XENDIT_SECRET_KEY` set). VidU’s ledger can show available balance while Xendit still has **₱0 on the brand sub-account** — refunds then fail with **`INSUFFICIENT_BALANCE`**.

You need **both**:

1. **App allows refund** — `xenditPoolSettled: true` (paid split marked settled in VidU, usually via **`split.payment`** webhook).
2. **Xendit can pay out** — brand **sub-account cash balance** ≥ refund amount (via **real split settlement** or **manual master → sub transfer**).

---

## Prerequisites

| Item | Where |
|------|--------|
| `XENDIT_SECRET_KEY` | `.env` — secret key with xenPlatform + payout permissions |
| `XENDIT_MASTER_USER_ID` | `.env` — master `user_id` from Xendit dashboard (source for transfers) |
| `XENDIT_WEBHOOK_TOKEN` | `.env` — matches Xendit webhook settings |
| Brand sub-account **LIVE** | Xendit → Accounts (status **Live testmode** / LIVE) |
| Default **`brand_refund`** payment method | App → brand payment methods |
| Funded campaign | Checkout paid; **Apply credit** if budget not credited yet |

Find the brand sub-account id:

```sql
SELECT bp.xendit_sub_account_id, bp.xendit_sub_account_status, u.email
FROM brand_profile bp
JOIN "user" u ON u.id = bp.user_id
WHERE u.email = '<brand-email>';
```

Or from the latest funding session:

```sql
SELECT xendit_sub_account_id, external_id, gross_amount, xendit_split_settled_at
FROM funding_checkout_session
WHERE campaign_id = '<campaign-id>' AND status = 'paid'
ORDER BY created_at DESC
LIMIT 1;
```

---

## Path A — Simulate split cash: master → sub (Xendit Dashboard)

Use this when the campaign is funded on the **master** (invoice PAID) but the **sub-account cash balance is still ₱0**, so refund would fail with `INSUFFICIENT_BALANCE`.

This mirrors “money landed on master after deposit; brand pool should sit on sub” **without** waiting for GCash T+2 settlement. It does **not** update VidU’s `xendit_split_settled_at` — only moves cash inside Xendit.

### 1. Confirm master has balance

After checkout, collected funds sit on the **master** account until split or transfer. In Xendit test mode, open the **master** account balance (same business as `XENDIT_MASTER_USER_ID`).

### 2. Create transfer in the dashboard

1. Open **[Xendit Dashboard](https://dashboard.xendit.co)** → **xenPlatform** → **Accounts** (all accounts under your master id).
2. Click **+ Create transfer** (top right).
3. Set:
   - **Source** — **Master** account (`XENDIT_MASTER_USER_ID` / your master business id).
   - **Destination** — the brand **Owned** sub-account (`xendit_sub_account_id` for that brand).
   - **Amount** — at least the refund you will send (e.g. campaign **available** net, or ≥ 85% of gross deposit for the brand pool share).
   - **Currency** — **PHP**.
4. Submit and wait until the transfer status is **SUCCESSFUL** (or equivalent completed state).

### 3. Verify sub balance

On **Accounts**, the destination row **Cash balance** should increase (e.g. PHP 17,000).

### 4. Refund in the app

- `xenditPoolSettled` must already be **true** (see Path B if the confirm button is still disabled).
- Budget → **Refund** → confirm.
- Expect a real disbursement (not `INSUFFICIENT_BALANCE`). A **DISBURSEMENT** webhook should hit your API when payout completes.

### Optional — same transfer via API (Postman / curl)

Equivalent to the dashboard button (hits Xendit, not VidU):

```http
POST https://api.xendit.co/transfers
Authorization: Basic <XENDIT_SECRET_KEY>:
Content-Type: application/json

{
  "reference": "manual_test_transfer_<unique>",
  "amount": 17000,
  "source_user_id": "<XENDIT_MASTER_USER_ID>",
  "destination_user_id": "<brand xendit_sub_account_id>"
}
```

Check status with `GET https://api.xendit.co/transfers/reference=<reference>`.

---

## Path B — Real test mode + webhooks (settlement + split)

Use this for the **production-like** flow: Xendit settles the invoice, runs the **split rule**, sends **`split.payment`**, VidU sets `xendit_split_settled_at`, and cash moves to the sub without a manual transfer.

### 1. Expose your API and register webhooks

1. Tunnel local API, e.g. `ngrok http 3001`.
2. Xendit Dashboard → **Settings** → **Webhooks** → one URL:
   - `https://<tunnel>/webhooks/xendit`
3. Enable products:
   - **INVOICES** (fund campaign on PAID)
   - **`split.payment`** (mark pool settled + split completed)
   - **DISBURSEMENT** (refund / payout status)
   - **xenPlatform** `account.created` (sub-account LIVE)
4. Set callback token = `XENDIT_WEBHOOK_TOKEN` in `.env`.

See [environment.md](./environment.md) for full env checklist.

### 2. Fund the campaign

1. App → **Fund & publish** or **Add funds** → pay in Xendit **test mode**.
2. Confirm **INVOICE** webhook delivered (2xx in Xendit webhook logs).
3. If budget not credited: Budget → **Apply credit** (`POST /brands/campaigns/:id/checkout/:externalId/sync`).

Campaign should be **active**; `xenditPoolSettled` may still be **false** until split completes.

### 3. Wait for settlement + split (or check Xendit)

- **GCash / e-wallet** in live mode: often ~**2 business days** after payment.
- **Test mode**: timing varies; watch Xendit **webhook logs** for **`split.payment`** with status **COMPLETED**.

When VidU receives it, backend logs: `Funding split settled on brand sub-account`.

Confirm in DB:

```sql
SELECT xendit_split_settled_at, xendit_sub_account_id
FROM funding_checkout_session
WHERE campaign_id = '<campaign-id>' AND status = 'paid';
```

`xendit_split_settled_at` should be non-null. API: `GET /brands/campaigns/:id` → **`xenditPoolSettled: true`**.

Sub-account **cash balance** in Xendit should show the brand pool amount (≈85% of gross after platform fee). If balance is still ₱0 but pool is settled in VidU, use **Path A** before refunding.

### 4. Refund in the app

Same as Path A step 4. Watch **DISBURSEMENT** webhook for payout **SUCCEEDED**.

---

## Recommended combinations

| Goal | Do this |
|------|---------|
| Fastest **real payout** test (skip T+2) | Fund → mark pool settled when split webhook fires **or** use Path B through step 2 then Path A for cash → refund |
| Full **end-to-end** Xendit | Path B only (fund → wait for `split.payment` → refund) |
| Fix **`INSUFFICIENT_BALANCE`** after pool already settled | Path A only (dashboard transfer ≥ refund amount) |

Typical hybrid when split webhook already ran but sub balance is wrong:

1. Path B through `xenditPoolSettled: true`.
2. Path A if sub **Cash balance** &lt; refund amount.
3. Refund in app.

---

## Refund checklist

| Check | OK when |
|-------|---------|
| `xenditPoolSettled: true` | `split.payment` COMPLETED received (Path B) |
| Sub-account **LIVE** | Xendit Accounts |
| Sub **cash balance** ≥ refund | Path A and/or Path B settlement |
| `availableBudget` > 0 | Campaign detail |
| Default `brand_refund` method | Brand account settings |

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| Refund button disabled (tooltip) | Pool not settled — complete Path B step 3; check `xendit_split_settled_at` |
| **`INSUFFICIENT_BALANCE`** | Sub has no cash — Path A transfer from master |
| Transfer fails on master | Master balance too low — fund another checkout or top up test master |
| No `split.payment` in Xendit logs | Webhook URL / product not registered; payment not settled yet |
| Webhook 403 | `x-callback-token` ≠ `XENDIT_WEBHOOK_TOKEN` |
| Refund **Failed** (other codes) | Check transaction `failureReason`; sub LIVE; channel limits |
| Dashboard transfer OK but app still blocked | Transfer does not set `xendit_split_settled_at` — still need Path B split webhook |

---

## Related

- [environment.md](./environment.md) — env vars and webhook products  
- Postman **Webhooks** — invoice PAID, `split.payment`, payout succeeded (for local replay only; dashboard transfer uses Xendit API directly)  
- `.env.example` — `XENDIT_MASTER_USER_ID`, `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN`
