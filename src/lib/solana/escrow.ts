import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3-compat";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3-compat";
import { getAnchorIdl, getProgramId, getSolanaConnection } from "./config.js";
import { loadBackendAuthorityKeypair } from "./keypair.js";
import { campaignPda, configPda, submissionPda, uuidToU8_16 } from "./pdas.js";
import { usdcToRawAmount } from "./amounts.js";
import { retryWithBackoff } from "./retry.js";
import type { Prisma } from "../../generated/prisma/client.js";

const CHAIN_ACTIVE = 1;

/** Read `SubmissionAllocation` after allocate / reallocate (pending status = 0). */
export async function fetchSubmissionAllocationOnChain(input: {
  campaignUuid: string;
  submissionUuid: string;
}): Promise<{ allocatedAmountRaw: BN; status: number } | null> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);
  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campaignPk, input.submissionUuid);

  const accountNs = program.account as unknown as {
    submissionAllocation: {
      fetch: (pk: PublicKey) => Promise<{ allocatedAmount: { toString(): string }; status: number }>;
    };
  };
  const raw = await accountNs.submissionAllocation.fetch(subPk).catch(() => null);
  if (!raw) return null;
  return {
    allocatedAmountRaw: new BN(raw.allocatedAmount.toString(), 10),
    status: raw.status,
  };
}

export async function allocateSubmissionOnChain(input: {
  campaignUuid: string;
  submissionUuid: string;
  testerWalletBase58: string;
  allocationUsdc: Prisma.Decimal;
  expiresAt: Date;
}): Promise<string> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const backend = loadBackendAuthorityKeypair();
  const wallet = new Wallet(backend);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campaignPk, input.submissionUuid);
  const cfgPk = configPda(programPk);
  const testerPk = new PublicKey(input.testerWalletBase58);

  const submissionIdArr = Array.from(uuidToU8_16(input.submissionUuid));
  const amount = usdcToRawAmount(input.allocationUsdc);
  const expiresSec = new BN(Math.floor(input.expiresAt.getTime() / 1000).toString());

  const accountNs = program.account as unknown as {
    campaignAccount: { fetch: (pk: PublicKey) => Promise<{ status: number; availableBalance: { toString(): string } }> };
  };
  const onChain = await accountNs.campaignAccount.fetch(campaignPk).catch(() => null);
  if (!onChain) {
    throw new Error("Campaign account missing on-chain (wrong program or cluster?)");
  }
  if (onChain.status !== CHAIN_ACTIVE) {
    throw new Error("Campaign is not Active on-chain");
  }
  if (new BN(onChain.availableBalance.toString()).lt(amount)) {
    throw new Error("Insufficient on-chain available balance for this allocation");
  }

  const sig = await retryWithBackoff(() =>
    program.methods
      .allocateSubmission(submissionIdArr, testerPk, amount, expiresSec)
      .accounts({
        config: cfgPk,
        backendAuthority: backend.publicKey,
        campaign: campaignPk,
        submission: subPk,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );

  const post = await fetchSubmissionAllocationOnChain({
    campaignUuid: input.campaignUuid,
    submissionUuid: input.submissionUuid,
  });
  if (!post || !post.allocatedAmountRaw.eq(amount) || post.status !== 0) {
    throw new Error(
      "allocate_submission confirmed but on-chain submission lock does not match the expected amount",
    );
  }
  return sig;
}

/** Adjust locked USDC for a pending submission (e.g. client changed severity / payout band). */
export async function reallocateSubmissionOnChain(input: {
  campaignUuid: string;
  submissionUuid: string;
  /** Must match `submissionAllocation.allocatedAmount` on-chain (DB mirror). */
  expectedCurrentUsdc: Prisma.Decimal;
  newAllocationUsdc: Prisma.Decimal;
}): Promise<string> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const backend = loadBackendAuthorityKeypair();
  const wallet = new Wallet(backend);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campaignPk, input.submissionUuid);
  const cfgPk = configPda(programPk);

  const accountNs = program.account as unknown as {
    campaignAccount: { fetch: (pk: PublicKey) => Promise<{ status: number; availableBalance: { toString(): string } }> };
    submissionAllocation: {
      fetch: (pk: PublicKey) => Promise<{ allocatedAmount: { toString(): string }; status: number }>;
    };
  };

  const [onChain, subOnChain] = await Promise.all([
    accountNs.campaignAccount.fetch(campaignPk).catch(() => null),
    accountNs.submissionAllocation.fetch(subPk).catch(() => null),
  ]);
  if (!onChain) {
    throw new Error("Campaign account missing on-chain (wrong program or cluster?)");
  }
  if (onChain.status !== CHAIN_ACTIVE) {
    throw new Error("Campaign is not Active on-chain");
  }
  if (!subOnChain) {
    throw new Error("Submission allocation account missing on-chain");
  }
  if (subOnChain.status !== 0) {
    throw new Error("Submission is not pending on-chain; re-allocation is not allowed");
  }

  const expectedRaw = usdcToRawAmount(input.expectedCurrentUsdc);
  const chainRaw = new BN(subOnChain.allocatedAmount.toString());
  if (!chainRaw.eq(expectedRaw)) {
    throw new Error(
      "On-chain allocation does not match the server record; refresh the page and try again.",
    );
  }

  const newRaw = usdcToRawAmount(input.newAllocationUsdc);
  if (newRaw.lte(new BN(0))) {
    throw new Error("New allocation must be greater than zero");
  }

  if (newRaw.gt(chainRaw)) {
    const need = newRaw.sub(chainRaw);
    if (new BN(onChain.availableBalance.toString()).lt(need)) {
      throw new Error("Insufficient on-chain available balance for this re-allocation");
    }
  }

  const sig = await retryWithBackoff(() =>
    program.methods
      .reallocateSubmission(newRaw)
      .accounts({
        config: cfgPk,
        backendAuthority: backend.publicKey,
        campaign: campaignPk,
        submission: subPk,
      })
      .rpc(),
  );

  const post = await fetchSubmissionAllocationOnChain({
    campaignUuid: input.campaignUuid,
    submissionUuid: input.submissionUuid,
  });
  if (!post || !post.allocatedAmountRaw.eq(newRaw) || post.status !== 0) {
    throw new Error(
      "reallocate_submission confirmed but on-chain submission lock does not match the expected amount",
    );
  }
  return sig;
}

export async function rejectSubmissionOnChain(input: {
  campaignUuid: string;
  submissionUuid: string;
}): Promise<string> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const backend = loadBackendAuthorityKeypair();
  const wallet = new Wallet(backend);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campaignPk, input.submissionUuid);
  const cfgPk = configPda(programPk);

  return retryWithBackoff(() =>
    program.methods
      .rejectSubmission()
      .accounts({
        authority: backend.publicKey,
        config: cfgPk,
        campaign: campaignPk,
        submission: subPk,
      })
      .rpc(),
  );
}

/** `pause_campaign` — backend authority only; campaign must be Active on-chain. */
export async function pauseCampaignOnChain(input: { campaignUuid: string }): Promise<string> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const backend = loadBackendAuthorityKeypair();
  const wallet = new Wallet(backend);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const cfgPk = configPda(programPk);

  return retryWithBackoff(() =>
    program.methods
      .pauseCampaign()
      .accounts({
        config: cfgPk,
        backendAuthority: backend.publicKey,
        campaign: campaignPk,
      })
      .rpc(),
  );
}

/** `resume_campaign` — backend authority only; campaign must be Paused on-chain. */
export async function resumeCampaignOnChain(input: { campaignUuid: string }): Promise<string> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const backend = loadBackendAuthorityKeypair();
  const wallet = new Wallet(backend);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const cfgPk = configPda(programPk);

  return retryWithBackoff(() =>
    program.methods
      .resumeCampaign()
      .accounts({
        config: cfgPk,
        backendAuthority: backend.publicKey,
        campaign: campaignPk,
      })
      .rpc(),
  );
}

/** Read-only: campaign vault accounting on-chain (for close / health checks). */
export async function getCampaignAccountOnChain(campaignUuid: string): Promise<{
  allocatedBalance: BN;
  availableBalance: BN;
  status: number;
} | null> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const idl = getAnchorIdl();
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);
  const campaignPk = campaignPda(programPk, campaignUuid);

  const accountNs = program.account as unknown as {
    campaignAccount: {
      fetch: (pk: PublicKey) => Promise<{
        status: number;
        availableBalance: { toString(): string };
        allocatedBalance: { toString(): string };
      }>;
    };
  };
  const raw = await accountNs.campaignAccount.fetch(campaignPk).catch(() => null);
  if (!raw) return null;
  return {
    status: raw.status,
    availableBalance: new BN(raw.availableBalance.toString(), 10),
    allocatedBalance: new BN(raw.allocatedBalance.toString(), 10),
  };
}
