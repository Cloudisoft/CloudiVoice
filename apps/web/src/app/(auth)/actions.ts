"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { env } from "@cloudivoice/core/env";
import {
  acceptInvitation,
  AuthError,
  createPasswordReset,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from "@cloudivoice/core/services/auth";
import { rateLimit, hashIp } from "@cloudivoice/core/services/system";
import { ensureMigrated } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { clearSessionCookie, requestMeta, sessionToken, setSessionCookie } from "@/lib/session";

export interface FormState {
  error?: string;
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

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const values = {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    company: String(form.get("company") ?? ""),
  };
  if (await limited("signup", 10)) return { error: "Too many attempts. Please wait a few minutes.", values };
  if (form.get("terms") !== "on") return { fieldErrors: { terms: "Please accept the terms to continue." }, values };
  try {
    const { token } = await signUp({ ...values, password: String(form.get("password") ?? "") }, await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof ZodError) return { fieldErrors: zodErrors(e), values };
    if (e instanceof AuthError) return { error: e.message, values };
    console.error("[signup]", e);
    return { error: "Something went wrong creating your account. Please try again.", values };
  }
  const scenario = String(form.get("scenario") ?? "");
  const lang = String(form.get("lang") ?? "");
  const qs = new URLSearchParams();
  if (/^[a-z]{3,20}$/.test(scenario)) qs.set("scenario", scenario);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(lang)) qs.set("lang", lang);
  redirect(`/onboarding${qs.size ? `?${qs}` : ""}`);
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  await ensureMigrated();
  const email = String(form.get("email") ?? "");
  if (await limited("login", 20)) return { error: "Too many sign-in attempts. Please wait a few minutes.", values: { email } };
  try {
    const { token } = await signIn(email, String(form.get("password") ?? ""), await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, values: { email } };
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
    const r = await sendMail(reset.email, "Reset your CloudiVoice password", `Hi ${reset.name},\n\nUse this link to set a new password. It expires in one hour.`, link);
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
