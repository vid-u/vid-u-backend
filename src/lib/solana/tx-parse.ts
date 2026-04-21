import type { PublicKey, VersionedTransactionResponse } from "@solana/web3-compat";
import bs58 from "bs58";

export function accountKeysForTx(tx: VersionedTransactionResponse) {
  const { message } = tx.transaction;
  const loaded = tx.meta?.loadedAddresses;
  if (message.version === "legacy") {
    return message.getAccountKeys();
  }
  return message.getAccountKeys({
    accountKeysFromLookups: loaded,
  });
}

export function disc8(data: Uint8Array): Uint8Array {
  return data.subarray(0, 8);
}

export function eq8(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 8 || b.length !== 8) return false;
  for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ixDataToBytes(data: Uint8Array | string): Buffer {
  if (typeof data === "string") {
    return Buffer.from(bs58.decode(data));
  }
  return Buffer.from(data);
}

/** Top-level message instructions only (no CPI / inner). Use for instruction shape checks. */
export function* eachOuterProgramInstruction(tx: VersionedTransactionResponse): Generator<{
  programIdIndex: number;
  accountKeyIndexes: number[];
  data: Uint8Array;
}> {
  for (const ix of tx.transaction.message.compiledInstructions) {
    yield {
      programIdIndex: ix.programIdIndex,
      accountKeyIndexes: ix.accountKeyIndexes,
      data: new Uint8Array(ix.data),
    };
  }
}

/** Outer + inner compiled instructions (inner uses legacy base58 `data` in some RPC shapes). */
export function* eachProgramInstruction(tx: VersionedTransactionResponse): Generator<{
  programIdIndex: number;
  accountKeyIndexes: number[];
  data: Uint8Array;
}> {
  for (const ix of tx.transaction.message.compiledInstructions) {
    yield {
      programIdIndex: ix.programIdIndex,
      accountKeyIndexes: ix.accountKeyIndexes,
      data: new Uint8Array(ix.data),
    };
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const raw of group.instructions) {
      const data = ixDataToBytes(raw.data as Uint8Array | string);
      yield {
        programIdIndex: raw.programIdIndex,
        accountKeyIndexes: Array.from(raw.accounts ?? (raw as { accountKeyIndexes?: number[] }).accountKeyIndexes ?? []),
        data: new Uint8Array(data),
      };
    }
  }
}

export function findIxMatching(
  tx: VersionedTransactionResponse,
  programPk: PublicKey,
  discriminator: Uint8Array,
  predicate: (
    keys: ReturnType<typeof accountKeysForTx>,
    accountKeyIndexes: number[],
    data: Uint8Array,
  ) => boolean,
): boolean {
  const keys = accountKeysForTx(tx);
  for (const ix of eachProgramInstruction(tx)) {
    const pid = keys.get(ix.programIdIndex);
    if (!pid || !pid.equals(programPk)) continue;
    if (ix.data.length < 8 || !eq8(disc8(ix.data), discriminator)) continue;
    if (predicate(keys, ix.accountKeyIndexes, ix.data)) return true;
  }
  return false;
}

/** Like `findIxMatching` but only outer (top-level) program instructions. */
export function findIxMatchingOuter(
  tx: VersionedTransactionResponse,
  programPk: PublicKey,
  discriminator: Uint8Array,
  predicate: (
    keys: ReturnType<typeof accountKeysForTx>,
    accountKeyIndexes: number[],
    data: Uint8Array,
  ) => boolean,
): boolean {
  const keys = accountKeysForTx(tx);
  for (const ix of eachOuterProgramInstruction(tx)) {
    const pid = keys.get(ix.programIdIndex);
    if (!pid || !pid.equals(programPk)) continue;
    if (ix.data.length < 8 || !eq8(disc8(ix.data), discriminator)) continue;
    if (predicate(keys, ix.accountKeyIndexes, ix.data)) return true;
  }
  return false;
}

export function readU64Le(buf: Uint8Array, offset: number): bigint {
  let x = 0n;
  for (let i = 0; i < 8; i++) {
    x |= BigInt(buf[offset + i]!) << (8n * BigInt(i));
  }
  return x;
}
