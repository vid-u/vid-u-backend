# Campaign funding sync (on-chain recovery)

Use this when a **client successfully signed Solana transactions** (`initialize_campaign` + `fund_campaign`) but **`POST /client/campaigns/:id/fund` failed** (network, RPC, or backend error). The API can **scan the chain** for matching transactions and **record funding in Postgres** without resigning.

## Requirements

- **`SOLANA_RPC_URL`** — JSON-RPC URL for the same cluster the client used (e.g. devnet).
- Optional **`SOLANA_WS_URL`** — only if your provider’s WebSocket URL is not the usual `http`→`ws` / `https`→`wss` twin of `SOLANA_RPC_URL`.
- The **profile wallet** (`users.wallet_address`) must match the on-chain **client signer** used for init/fund.
- Campaign must **not** already have funding recorded (`escrowPda` is `null`).

## How it works

1. The backend derives the **campaign PDA** from the campaign UUID and loads **`getSignaturesForAddress`** since **`created_at`** (minus a short clock-skew window).
2. It fetches transactions and looks for **outer** `initialize_campaign` and `fund_campaign` instructions that match this campaign and client wallet (same discriminators and checks as `verify-campaign-tx`).
3. It pairs **init + fund** (either **one transaction** containing both, or **two** transactions in time order).
4. **GET** only returns what was found (no DB write). **POST** runs the same verifiers as manual fund, then applies the same database updates as **`POST .../fund`** (campaign row + creation fee row).

## Endpoints

Both require **`Authorization: Bearer &lt;Supabase JWT&gt;`** and role **client**. The authenticated user must **own** the campaign.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| **GET** | `/client/campaigns/:id/sync-fund` | — | **Preview**: whether on-chain funding was found and which signatures / amount. |
| **POST** | `/client/campaigns/:id/sync-fund` | — | **Apply**: verify signatures and persist funding (same outcome as a successful `POST .../fund`). |

**`:id`** — campaign UUID (same as elsewhere in the client campaign API).

### GET response shapes

- **Already funded in DB** — `alreadyFunded: true`, `escrowPda`, short `message`.
- **Nothing recoverable on-chain** — `alreadyFunded: false`, `recoverable: false`, `escrowPda` (derived PDA for reference), `message` explaining no match.
- **Recoverable** — `alreadyFunded: false`, `recoverable: true`, `escrowPda`, `initializeTxSignature`, `fundTxSignature` (may be identical if both instructions are in one transaction), `fundedUsdc` (string, decimal USDC), `message` with a hint to use POST to persist.

### POST response

On success, aligns with **`POST /client/campaigns/:id/fund`**: `data.campaign`, `data.chain` including `initializeTx`, `fundTx`, plus `recoveredFromChain: true` in `chain`.

### Errors

- **400** — validation (e.g. already funded, no match on chain, verification failed, missing `SOLANA_RPC_URL`, no wallet on profile).
- **404** — campaign not found or not owned by the client.

## Operational notes

- Scanning is **bounded** (signature pages and maximum transactions fetched); extremely busy PDAs are unusual for a single campaign.
- Default limits in code (see `src/lib/solana/scan-campaign-funding.ts`): **5 minutes** clock skew before `created_at`, up to **40** pages of **`getSignaturesForAddress`**, cap **120** signatures fully fetched — adjust there if you hit edge cases.
- Recovery assumes the **same cluster and program** as configured in the API (`BUGHYVE_PROGRAM_ID`, `SOLANA_RPC_URL`).

## Related

- Env reference: [deployment.md](./deployment.md) (Solana variables, including optional `SOLANA_WS_URL`).
- **Postman:** **Client → Campaigns** includes **GET** and **POST** `/client/campaigns/:id/sync-fund` (see `postman/BugHyve-API.postman_collection.json`).
