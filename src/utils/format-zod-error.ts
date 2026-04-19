/**
 * Human-readable summary from Zod's `.flatten()` output for API error responses.
 */
export function formatFlattenedZodError(flat: {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
}): string {
  const parts: string[] = [];
  for (const msg of flat.formErrors) {
    if (msg) parts.push(msg);
  }
  for (const [path, msgs] of Object.entries(flat.fieldErrors)) {
    if (!msgs?.length) continue;
    const label =
      path === "" || path === "_root" ? "Request" : path.replace(/\./g, " › ");
    parts.push(`${label}: ${msgs.join(", ")}`);
  }
  const out = parts.join("; ");
  if (!out) return "Invalid input";
  return out.length > 600 ? `${out.slice(0, 597)}...` : out;
}
