import type { Request, Response } from "express";
import { clearSessionCookie, setSessionCookie } from "../lib/auth-cookie.js";
import { sendSuccess } from "../utils/api-response.js";
import {
  clearGooglePkceCookie,
  completeGoogleOAuth,
  googlePkceCookieName,
  sendEmailOtp,
  startGoogleOAuth,
  verifyEmailOtp,
} from "../services/auth.service.js";
import { env } from "../lib/env.js";

export async function postEmailSendCode(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  await sendEmailOtp(email);
  sendSuccess(res, { ok: true });
}

export async function postEmailVerify(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as { email: string; code: string };
  const session = await verifyEmailOtp(email, code);
  setSessionCookie(res, session.accessToken);
  sendSuccess(res, {
    requiresRoleSelection: session.requiresRoleSelection,
  });
}

export async function getGoogleStart(_req: Request, res: Response): Promise<void> {
  startGoogleOAuth(res);
}

export async function getGoogleCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const verifier =
    typeof req.cookies?.[googlePkceCookieName] === "string"
      ? req.cookies[googlePkceCookieName]
      : undefined;
  const session = await completeGoogleOAuth(code, verifier);
  clearGooglePkceCookie(res);
  setSessionCookie(res, session.accessToken);
  const redirectBase = env.FRONTEND_URL?.split(",")[0]?.trim() ?? "http://localhost:5173";
  const url = new URL("/", redirectBase);
  if (session.requiresRoleSelection) {
    url.searchParams.set("requires_role", "1");
  }
  res.redirect(302, url.toString());
}

export async function postSignOut(_req: Request, res: Response): Promise<void> {
  clearSessionCookie(res);
  sendSuccess(res, { ok: true });
}
