import type { Request, Response } from "express";
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
  sendSuccess(res, {
    sessionToken: session.accessToken,
    refreshToken: session.refreshToken,
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
  const redirectBase = env.FRONTEND_URL?.split(",")[0]?.trim() ?? "http://localhost:5173";
  const url = new URL("/", redirectBase);
  url.searchParams.set("session_token", session.accessToken);
  url.searchParams.set("requires_role", session.requiresRoleSelection ? "1" : "0");
  res.redirect(302, url.toString());
}

export async function postSignOut(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, { ok: true });
}
