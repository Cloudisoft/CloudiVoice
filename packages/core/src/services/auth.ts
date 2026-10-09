import { z } from "zod";
import { hashPassword, randomToken, sha256, verifyPassword } from "../crypto";
import { db, withSystem, type Tx } from "../db/client";
import { pricing } from "../pricing";

export const ROLES = ["admin", "manager", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Permission checks are by capability, not by role name. */
export const PERMISSIONS = {
  "org.manage": ["admin"],
  "team.manage": ["admin"],
  "billing.view": ["admin", "manager"],
  "settings.manage": ["admin", "manager"],
  "integrations.manage": ["admin"],
  "agents.edit": ["admin", "manager"],
  "agents.view": ["admin", "manager", "operator", "viewer"],
  "leads.edit": ["admin", "manager", "operator"],
  "leads.delete": ["admin", "manager"],
  "leads.export": ["admin", "manager"],
  "numbers.manage": ["admin", "manager"],
  "campaigns.edit": ["admin", "manager"],
  "campaigns.control": ["admin", "manager", "operator"],
  "calls.view": ["admin", "manager", "operator", "viewer"],
  "calls.supervise": ["admin", "manager", "operator"],
  "calls.override": ["admin", "manager"],
  "calls.test": ["admin", "manager", "operator"],
  "recordings.listen": ["admin", "manager", "operator"],
  "audit.view": ["admin"],
  "knowledge.edit": ["admin", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export class AuthError extends Error {}

export const SESSION_DAYS = 30;

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(200)
    .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letters and at least one number"),
  company: z.string().trim().min(2, "Please enter your company name").max(80),
});

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  orgId: string | null;
  orgName: string | null;
  role: Role | null;
}

async function createSessionTx(tx: Tx, userId: string, orgId: string | null, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  await tx`
    insert into sessions (id, user_id, active_org_id, expires_at, ip, user_agent)
    values (${sha256(token)}, ${userId}, ${orgId}, now() + ${`${SESSION_DAYS} days`}::interval, ${meta.ip ?? null}, ${meta.userAgent?.slice(0, 300) ?? null})`;
  return token;
}

/** Sign up creates the user, their organization (as admin) and a session. */
export async function signUp(input: z.infer<typeof signupSchema>, meta: { ip?: string; userAgent?: string } = {}) {
  const data = signupSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return withSystem(async (tx) => {
    const [exists] = await tx`select 1 from users where lower(email) = ${data.email}`;
    if (exists) throw new AuthError("An account with this email already exists. Try signing in.");
    const [user] = await tx<{ id: string }[]>`
      insert into users (email, name, password_hash) values (${data.email}, ${data.name}, ${passwordHash}) returning id`;
    const [org] = await tx<{ id: string }[]>`
      insert into organizations (name, slug) values (${data.company}, ${slugify(data.company)}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${org!.id}, ${user!.id}, 'admin')`;
    await tx`insert into usage_ledger (org_id, category, quantity, unit, amount_paise, description)
             values (${org!.id}, 'credit', 1, 'grant', ${-pricing().welcomeCredits}, 'Welcome credits')`;
    await tx`insert into audit_logs (org_id, actor_user_id, action, entity_type, entity_id)
             values (${org!.id}, ${user!.id}, 'org.created', 'organization', ${org!.id})`;
    const token = await createSessionTx(tx, user!.id, org!.id, meta);
    return { token, userId: user!.id, orgId: org!.id };
  });
}

export async function signIn(email: string, password: string, meta: { ip?: string; userAgent?: string } = {}) {
  const normalized = email.trim().toLowerCase();
  const [user] = await db()<{ id: string; password_hash: string }[]>`
    select id, password_hash from users where lower(email) = ${normalized}`;
  // Always run a hash comparison to keep timing uniform.
  const ok = await verifyPassword(password, user?.password_hash ?? "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!user || !ok) throw new AuthError("That email and password don't match.");
  return withSystem(async (tx) => {
    const [m] = await tx<{ org_id: string }[]>`
      select org_id from memberships where user_id = ${user.id} order by created_at asc limit 1`;
    await tx`update users set last_login_at = now() where id = ${user.id}`;
    return { token: await createSessionTx(tx, user.id, m?.org_id ?? null, meta), userId: user.id };
  });
}

export async function getSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20) return null;
  const [row] = await db()<
    {
      session_id: string;
      user_id: string;
      email: string;
      name: string;
      org_id: string | null;
      org_name: string | null;
      role: Role | null;
    }[]
  >`
    select s.id as session_id, u.id as user_id, u.email, u.name,
           m.org_id, o.name as org_name, m.role
    from sessions s
    join users u on u.id = s.user_id
    left join memberships m on m.user_id = u.id and m.org_id = s.active_org_id
    left join organizations o on o.id = m.org_id
    where s.id = ${sha256(token)} and s.expires_at > now()`;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
  };
}

export async function signOut(token: string) {
  await db()`delete from sessions where id = ${sha256(token)}`;
}

export async function signOutEverywhere(userId: string) {
  await db()`delete from sessions where user_id = ${userId}`;
}

export async function listSessions(userId: string) {
  return db()<{ id: string; created_at: Date; ip: string | null; user_agent: string | null; expires_at: Date }[]>`
    select id, created_at, ip, user_agent, expires_at from sessions
    where user_id = ${userId} and expires_at > now() order by created_at desc`;
}

export async function switchOrg(token: string, userId: string, orgId: string) {
  const [m] = await db()`select 1 from memberships where user_id = ${userId} and org_id = ${orgId}`;
  if (!m) throw new AuthError("You are not a member of that organization.");
  await db()`update sessions set active_org_id = ${orgId} where id = ${sha256(token)}`;
}

export async function userOrgs(userId: string) {
  return db()<{ id: string; name: string; role: Role }[]>`
    select o.id, o.name, m.role from memberships m join organizations o on o.id = m.org_id
    where m.user_id = ${userId} order by o.name`;
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
export async function createPasswordReset(email: string): Promise<{ token: string; name: string; email: string } | null> {
  const [user] = await db()<{ id: string; name: string; email: string }[]>`
    select id, name, email from users where lower(email) = ${email.trim().toLowerCase()}`;
  if (!user) return null;
  const token = randomToken(32);
  await db()`insert into password_resets (token_hash, user_id, expires_at)
             values (${sha256(token)}, ${user.id}, now() + interval '1 hour')`;
  return { token, name: user.name, email: user.email };
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = signupSchema.shape.password.parse(newPassword);
  const hash = await hashPassword(pw);
  await withSystem(async (tx) => {
    const [r] = await tx<{ user_id: string }[]>`
      update password_resets set used_at = now()
      where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
      returning user_id`;
    if (!r) throw new AuthError("This reset link is invalid or has expired. Request a new one.");
    await tx`update users set password_hash = ${hash} where id = ${r.user_id}`;
    await tx`delete from sessions where user_id = ${r.user_id}`;
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
export async function createInvitation(orgId: string, invitedBy: string, email: string, role: Role) {
  const normalized = z.string().trim().toLowerCase().email().parse(email);
  if (!ROLES.includes(role)) throw new AuthError("Unknown role");
  const token = randomToken(32);
  await withSystem(async (tx) => {
    await tx`insert into invitations (org_id, email, role, token_hash, invited_by, expires_at)
             values (${orgId}, ${normalized}, ${role}, ${sha256(token)}, ${invitedBy}, now() + interval '7 days')`;
    await tx`insert into audit_logs (org_id, actor_user_id, action, entity_type, details)
             values (${orgId}, ${invitedBy}, 'team.invited', 'invitation', ${tx.json({ email: normalized, role })})`;
  });
  return token;
}

export async function getInvitation(token: string) {
  const [inv] = await db()<{ id: string; org_id: string; org_name: string; email: string; role: Role }[]>`
    select i.id, i.org_id, o.name as org_name, i.email, i.role
    from invitations i join organizations o on o.id = i.org_id
    where i.token_hash = ${sha256(token)} and i.accepted_at is null and i.expires_at > now()`;
  return inv ?? null;
}

/** Accept an invitation, creating the user account if needed. */
export async function acceptInvitation(
  token: string,
  input: { name?: string; password: string },
  meta: { ip?: string; userAgent?: string } = {},
) {
  const inv = await getInvitation(token);
  if (!inv) throw new AuthError("This invitation is invalid or has expired.");
  return withSystem(async (tx) => {
    let [user] = await tx<{ id: string; password_hash: string }[]>`
      select id, password_hash from users where lower(email) = ${inv.email}`;
    if (user) {
      if (!(await verifyPassword(input.password, user.password_hash))) throw new AuthError("Incorrect password for this account.");
    } else {
      const name = z.string().trim().min(2).max(80).parse(input.name ?? "");
      const pw = signupSchema.shape.password.parse(input.password);
      [user] = await tx<{ id: string; password_hash: string }[]>`
        insert into users (email, name, password_hash) values (${inv.email}, ${name}, ${await hashPassword(pw)})
        returning id, password_hash`;
    }
    await tx`insert into memberships (org_id, user_id, role) values (${inv.org_id}, ${user!.id}, ${inv.role})
             on conflict (org_id, user_id) do update set role = excluded.role`;
    await tx`update invitations set accepted_at = now() where id = ${inv.id}`;
    await tx`insert into audit_logs (org_id, actor_user_id, action, entity_type, details)
             values (${inv.org_id}, ${user!.id}, 'team.joined', 'membership', ${tx.json({ role: inv.role })})`;
    return { token: await createSessionTx(tx, user!.id, inv.org_id, meta) };
  });
}
