"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { env } from "@cloudivoice/core/env";
import {
  acceptInvitation,
  AuthError,
  createEmailVerification,
  createPasswordReset,
  resetPassword,
  signIn,
  signOut,
  signUp,
  verifyEmail,
} from "@cloudivoice/core/services/auth";
import { rateLimit, hashIp } from "@cloudivoice/core/services/system";
import { ensureMigrated } from "@/lib/db";
import { emailDeliveryAvailable, sendActionEmail } from "@/lib/mail";
import { clearSessionCookie, requestMeta, sessionToken, setSessionCookie } from "@/lib/session";

export interface FormState {
  error?: string;
  /** Sign-in blocked until the email is confirmed (offer to resend). */
  unverified?: boolean;
  fieldErrors?: Record<string, string>;
  ok?: string;
  devLink?: string;
  values?: Record<string, string>;
}

function zodErrors(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const k = String(issue.path[0] ?? "form");
    out[k] ??= issue.message;
  }
  return out;
}

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : null;
}

async function limited(kind: string, limit: number) {
  const { ip } = await requestMeta();
  const r = await rateLimit(`${kind}:${hashIp(ip ?? "unknown")}`, limit, 15 * 60);
  return !r.ok;
}

async function sendVerification(email: string, next: string | null) {
  const v = await createEmailVerification(email);
  if (!v) return { sent: false } as { sent: boolean; devLink?: string };
  const link = `${env.appUrl}/verify-email/${v.token}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return sendActionEmail(v.email, "Confirm your email for CloudiVoice", {
    greeting: `Hi ${v.name.split(" ")[0]},`,
    lines: ["Welcome to CloudiVoice! Confirm your email address to activate your account and start building your first voice agent."],
    cta: "Confirm my email",
    link,
    footnote: "This link expires in 48 hours. If you didn’t create a CloudiVoice account, you can ignore this email.",
  });
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const values = {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    company: String(form.get("company") ?? ""),
  };
  if (await limited("signup", 10)) return { error: "Too many attempts. Please wait a few minutes.", values };
  if (form.get("terms") !== "on") return { fieldErrors: { terms: "Please accept the terms to continue." }, values };

  const scenario = String(form.get("scenario") ?? "");
  const lang = String(form.get("lang") ?? "");
  const qs = new URLSearchParams();
  if (/^[a-z]{3,20}$/.test(scenario)) qs.set("scenario", scenario);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(lang)) qs.set("lang", lang);
  const onboarding = `/onboarding${qs.size ? `?${qs}` : ""}`;

  // Email confirmation is required whenever we can actually deliver email.
  const verify = emailDeliveryAvailable();
  let email: string;
  try {
    const res = await signUp({ ...values, password: String(form.get("password") ?? "") }, await requestMeta(), { verified: !verify });
    email = res.email;
    if (res.token) await setSessionCookie(res.token);
  } catch (e) {
    if (e instanceof ZodError) return { fieldErrors: zodErrors(e), values };
    if (e instanceof AuthError) return { error: e.message, values };
    console.error("[signup]", e);
    return { error: "Something went wrong creating your account. Please try again.", values };
  }
  if (!verify) redirect(onboarding);
  const sent = await sendVerification(email, onboarding).catch((e) => {
    console.error("[signup] verification email", e);
    return { sent: false } as { sent: boolean; devLink?: string };
  });
  const p = new URLSearchParams({ email });
  if (sent.devLink) p.set("dev", sent.devLink);
  redirect(`/verify-email?${p}`);
}

/** Resend the confirmation email (same answer whether or not the account exists). */
export async function resendVerificationAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };
  if (await limited("verify-resend", 5)) return { error: "Too many requests. Please wait a few minutes and try again." };
  const r = await sendVerification(email, "/onboarding").catch((e) => {
    console.error("[resend verification]", e);
    return { sent: false } as { sent: boolean; devLink?: string };
  });
  return { ok: "If that account still needs confirming, a new link is on its way. Check your inbox and spam folder.", devLink: r.devLink };
}

/** Confirm the email from the link, sign in and continue to onboarding. */
export async function confirmEmailAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { token } = await verifyEmail(String(form.get("token") ?? ""), await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    console.error("[verify]", e);
    return { error: "We couldn't confirm your email right now. Please try again." };
  }
  redirect(safeNext(form.get("next")) ?? "/onboarding");
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const email = String(form.get("email") ?? "");
  if (await limited("login", 20)) return { error: "Too many sign-in attempts. Please wait a few minutes.", values: { email } };
  try {
    const { token } = await signIn(email, String(form.get("password") ?? ""), await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, unverified: e.code === "unverified", values: { email } };
    console.error("[login]", e);
    return { error: "We couldn't sign you in right now. Please try again.", values: { email } };
  }
  redirect(safeNext(form.get("next")) ?? "/app");
}

export async function logoutAction() {
  const token = await sessionToken();
  if (token) await signOut(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const email = String(form.get("email") ?? "").trim();
  if (await limited("forgot", 5)) return { error: "Too many requests. Please wait a few minutes." };
  const reset = await createPasswordReset(email);
  let devLink: string | undefined;
  if (reset) {
    const link = `${env.appUrl}/reset-password/${reset.token}`;
    const r = await sendActionEmail(reset.email, "Reset your CloudiVoice password", {
      greeting: `Hi ${reset.name.split(" ")[0]},`,
      lines: ["We received a request to reset the password for your CloudiVoice account. Use the button below to choose a new one."],
      cta: "Reset password",
      link,
      footnote: "This link expires in one hour and can be used once. If you didn’t ask for this, you can ignore this email — your password won’t change.",
    }).catch((e) => {
      console.error("[forgot] email", e);
      return { sent: false } as { sent: boolean; devLink?: string };
    });
    devLink = r.devLink;
  }
  // Same response whether or not the account exists.
  return { ok: "If an account exists for that email, we've sent a reset link. It expires in one hour.", devLink };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { fieldErrors: { confirm: "Passwords don't match." } };
  try {
    await resetPassword(token, password);
  } catch (e) {
    if (e instanceof ZodError) return { fieldErrors: { password: e.issues[0]?.message ?? "Invalid password" } };
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
  redirect("/login?reset=1");
}

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { token } = await acceptInvitation(
      String(form.get("token") ?? ""),
      { name: String(form.get("name") ?? "") || undefined, password: String(form.get("password") ?? "") },
      await requestMeta(),
    );
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof ZodError) return { fieldErrors: zodErrors(e) };
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
  redirect("/app");
}
