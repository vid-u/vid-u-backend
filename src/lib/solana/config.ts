/** Anchor expects `@solana/web3.js` `Connection`. Avoid `@solana/web3-compat`'s Connection here: it routes subscriptions through Kit and passes the HTTP RPC URL as the WebSocket URL when no `wsEndpoint` is set, which throws (`https:` is invalid for WebSocket). */
import { Connection, PublicKey } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import { env } from "../env.js";
import idlJson from "../../idl/bughyve_escrow.json" with { type: "json" };

export function getSolanaConnection(): Connection {
  const url = env.SOLANA_RPC_URL?.trim();
  if (!url) throw new Error("SOLANA_RPC_URL is not set");
  const ws = env.SOLANA_WS_URL?.trim();
  return new Connection(url, {
    commitment: "confirmed",
    ...(ws ? { wsEndpoint: ws } : {}),
  });
}

export function getProgramId(): PublicKey {
  const fromEnv = env.BUGHYVE_PROGRAM_ID?.trim();
  const id = fromEnv || (idlJson as { address: string }).address;
  return new PublicKey(id);
}

/** IDL with `address` aligned to env program id (required if overriding deploy). */
export function getAnchorIdl(): Idl {
  const address = getProgramId().toBase58();
  return { ...(idlJson as object), address } as Idl;
}

/** Backend can allocate/reject (backend_authority signer). */
export function solanaBackendConfigured(): boolean {
  return Boolean(
    env.SOLANA_RPC_URL?.trim() &&
      getProgramId() &&
      env.BACKEND_AUTHORITY_SECRET?.trim(),
  );
}

/** Read chain state / verify client-signed txs (approve). Reject uses backend authority when configured. */
export function solanaRpcConfigured(): boolean {
  return Boolean(env.SOLANA_RPC_URL?.trim());
}
