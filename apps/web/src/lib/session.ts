import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, getSession, type Permission, type Role, type SessionUser, SESSION_DAYS } from "@cloudivoice/core/services/auth";
import { withTenant, type Tx } from "@cloudivoice/core/db/client";
import { ensureMigrated } from "./db";

export const SESSION_COOKIE = "cv_session";

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  await ensureMigrated();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSession(token);
});

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

export interface OrgUser extends SessionUser {
  orgId: string;
  orgName: string;
  role: Role;
}

/** Signed-in user with an active organization, or redirect. */
export async function requireOrgUser(): Promise<OrgUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.orgId || !user.role) redirect("/onboarding");
  return user as OrgUser;
}

export async function requirePermission(permission: Permission): Promise<OrgUser> {
  const user = await requireOrgUser();
  if (!can(user.role, permission)) redirect("/app?denied=1");
  return user;
}

/** Run a tenant-scoped query for the current user (server-side authorization first). */
export async function tenant<T>(fn: (tx: Tx, user: OrgUser) => Promise<T>, permission?: Permission): Promise<T> {
  const user = permission ? await requirePermission(permission) : await requireOrgUser();
  return withTenant(user.orgId, (tx) => fn(tx, user));
}

export function hasPermission(user: { role: Role | null }, p: Permission) {
  return Boolean(user.role && can(user.role, p));
}
