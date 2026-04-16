import { env } from "../lib/env.js";
import { logger } from "../utils/logger.js";

type ResendClient = import("resend").Resend;

let resendClient: ResendClient | null = null;
let resendImportFailed = false;

/**
 * Lazy-loads Resend so the API process can boot even if `resend` is missing
 * from the container `node_modules` volume (run `docker compose exec backend npm install`).
 */
async function getResend(): Promise<ResendClient | null> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (resendClient) return resendClient;
  if (resendImportFailed) return null;
  try {
    const { Resend } = await import("resend");
    resendClient = new Resend(key);
    return resendClient;
  } catch (e) {
    resendImportFailed = true;
    logger.error(
      "Resend package failed to load (run npm install in the container?)",
      {
        error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** First origin from `FRONTEND_URL` (may be comma-separated for CORS). */
function getFrontendOriginForEmail(): string | null {
  const raw = env.FRONTEND_URL?.trim();
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  return first.replace(/\/+$/, "");
}

/**
 * Public URLs for brand images in HTML email (served from the landing site `public/`, e.g. bughyve.com).
 * Uses raster logo for client compatibility (SVG is often blocked or broken in email).
 */
function resolveEmailBrandImageUrls(): { logo: string | null; wordmark: string | null } {
  const origin = getFrontendOriginForEmail();
  const explicitLogo = env.EMAIL_LOGO_URL?.trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(origin ?? "")) {
    return { logo: explicitLogo || null, wordmark: null };
  }
  if (!origin) {
    return {
      logo: explicitLogo || null,
      wordmark: null,
    };
  }
  return {
    logo: explicitLogo || `${origin}/bughyve-logo.jpg`,
    wordmark: `${origin}/bughyve-wordmark.jpeg`,
  };
}

function emailBrandHeaderHtml(): string {
  const { logo, wordmark } = resolveEmailBrandImageUrls();
  if (!logo && !wordmark) return "";
  const logoCell = logo
    ? `<td style="vertical-align:middle;padding:0;">
  <img src="${escapeAttr(logo)}" alt="BugHyve" width="52" role="presentation" style="display:block;width:52px;height:auto;border:0;outline:none;text-decoration:none;" />
</td>`
    : "";
  const wordmarkCell = wordmark
    ? `<td style="vertical-align:middle;padding:0 0 0 14px;">
  <img src="${escapeAttr(wordmark)}" alt="BugHyve" width="200" role="presentation" style="display:block;max-width:220px;width:200px;height:auto;border:0;outline:none;text-decoration:none;" />
</td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse;"><tr>${logoCell}${wordmarkCell}</tr></table>`;
}

function emailBrandHeaderText(): string {
  return "";
}

/**
 * Resend `from`: if `RESEND_FROM_EMAIL` is a bare address, use a proper display name
 * so clients show "Franz from BugHyve" instead of a lowercase local-part.
 */
function formatResendFromAddress(): string {
  const raw = env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  if (/^[^\s<]+@[^\s>]+$/.test(raw)) {
    return `Franz from BugHyve <${raw}>`;
  }
  return raw;
}

function buildClientEmail(_toEmail: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "You're on the BugHyve waitlist";
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6;color:#1a1a1a;background:#faf9f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="max-width:560px;margin:0 auto;">
    ${emailBrandHeaderHtml()}
    <p style="margin:0 0 16px;font-size:15px;">Hey,</p>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;m Franz — founder of BugHyve.</p>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;m building this because I&apos;ve been in your position. Leading a team that ships fast with AI, and has limited QA coverage. At some point, something slips through — and when it does, the team ends up fixing in production, users hit broken flows and quietly leave, and you lose trust, momentum, and money.</p>
    <p style="margin:0 0 16px;font-size:15px;">That&apos;s the problem BugHyve solves.</p>
    <p style="margin:0 0 8px;font-size:15px;">With BugHyve you can:</p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;">
      <li style="margin:0 0 8px;">Run a QA testing campaign</li>
      <li style="margin:0 0 8px;">Get real testers exploring your product</li>
      <li style="margin:0 0 8px;">Pay only for confirmed bugs — nothing else</li>
    </ul>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;ll reach out as soon as early access opens.</p>
    <p style="margin:24px 0 0;font-size:15px;color:#333;">P.S. — Is this something your team is dealing with right now?<br />Hit &quot;Reply&quot; and let me know. I read every response.</p>
    <p style="margin:24px 0 0;font-size:15px;">Cheers,<br />Franz</p>
  </td></tr></table>
</body>
</html>`;
  const text = [
    emailBrandHeaderText(),
    "Hey,",
    "",
    "I'm Franz — founder of BugHyve.",
    "",
    "I'm building this because I've been in your position. Leading a team that ships fast with AI, and has limited QA coverage. At some point, something slips through — and when it does, the team ends up fixing in production, users hit broken flows and quietly leave, and you lose trust, momentum, and money.",
    "",
    "That's the problem BugHyve solves.",
    "",
    "With BugHyve you can:",
    "- Run a QA testing campaign",
    "- Get real testers exploring your product",
    "- Pay only for confirmed bugs — nothing else",
    "",
    "I'll reach out as soon as early access opens.",
    "",
    "P.S. — Is this something your team is dealing with right now?",
    `Hit "Reply" and let me know. I read every response.`,
    "",
    "Cheers,",
    "Franz",
  ].join("\n");
  return { subject, html, text };
}

function buildTesterEmail(_toEmail: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "You're on the BugHyve waitlist";
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6;color:#1a1a1a;background:#faf9f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="max-width:560px;margin:0 auto;">
    ${emailBrandHeaderHtml()}
    <p style="margin:0 0 16px;font-size:15px;">Hey,</p>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;m Franz — founder of BugHyve.</p>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;m building this because teams are shipping faster than ever with AI… and most products aren&apos;t getting enough real human testing before going live.</p>
    <p style="margin:0 0 16px;font-size:15px;">That&apos;s the gap you help fill.</p>
    <p style="margin:0 0 8px;font-size:15px;">You&apos;ll get to:</p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;">
      <li style="margin:0 0 8px;">Test real products</li>
      <li style="margin:0 0 8px;">Find real issues or improvements</li>
      <li style="margin:0 0 8px;">Get paid for valid contributions</li>
    </ul>
    <p style="margin:0 0 16px;font-size:15px;">Work on your own time, from anywhere.</p>
    <p style="margin:0 0 16px;font-size:15px;">I&apos;ll reach out as soon as the first campaigns go live.</p>
    <p style="margin:24px 0 0;font-size:15px;color:#333;">P.S. What made you sign up — QA background, or just curious about the earning side?<br />Hit reply and let me know. I read every response.</p>
    <p style="margin:24px 0 0;font-size:15px;">Cheers,<br />Franz</p>
  </td></tr></table>
</body>
</html>`;
  const text = [
    emailBrandHeaderText(),
    "Hey,",
    "",
    "I'm Franz — founder of BugHyve.",
    "",
    "I'm building this because teams are shipping faster than ever with AI… and most products aren't getting enough real human testing before going live.",
    "",
    "That's the gap you help fill.",
    "",
    "You'll get to:",
    "",
    "Test real products",
    "Find real issues",
    "Get paid for valid contributions",
    "Work on your own time, from anywhere.",
    "",
    "I'll reach out as soon as the first campaigns go live.",
    "",
    "P.S. What made you sign up — QA background, or just curious about the earning side?",
    "Hit reply and let me know. I read every response.",
    "",
    "Cheers,",
    "Franz",
  ].join("\n");
  return { subject, html, text };
}

/**
 * Optional follow-up email after a **new** waitlist row is created.
 * Never throws: failures (rate limits, invalid key, network, etc.) are logged only;
 * the waitlist API response must not depend on Resend.
 */
export async function sendWaitlistConfirmationEmail(
  to: string,
  role: "client" | "tester",
): Promise<void> {
  try {
    const resend = await getResend();
    if (!resend) {
      if (!env.RESEND_API_KEY?.trim()) {
        logger.warn(
          "RESEND_API_KEY not set; skipping waitlist confirmation email",
        );
      }
      return;
    }

    const from = formatResendFromAddress();
    const payload =
      role === "client" ? buildClientEmail(to) : buildTesterEmail(to);

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (error) {
      logger.warn(
        "Waitlist confirmation email skipped (Resend error; signup already saved)",
        {
          message: error.message,
          to,
          role,
        },
      );
      return;
    }

    logger.info("Waitlist confirmation email sent", {
      to,
      role,
      id: data?.id,
    });
  } catch (e) {
    logger.warn("Waitlist confirmation email failed (signup already saved)", {
      error: e instanceof Error ? e.message : String(e),
      to,
      role,
    });
  }
}
