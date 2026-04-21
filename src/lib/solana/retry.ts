/** Heuristic: RPC / transport errors worth retrying (not program Simulation or logical failures). */
export function isTransientSolanaError(err: unknown): boolean {
  const m = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  return /429|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|Too many requests|fetch failed|socket hang up|503|502|504|try again|Temporary/i.test(
    m,
  );
}

export async function retryWithBackoff<T>(
  fn: (attemptIndex: number) => Promise<T>,
  opts?: { maxAttempts?: number; baseMs?: number; maxMs?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseMs = opts?.baseMs ?? 150;
  const maxMs = opts?.maxMs ?? 8_000;
  let last: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i === maxAttempts - 1 || !isTransientSolanaError(e)) throw e;
      const delay = Math.min(maxMs, baseMs * 2 ** i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}
