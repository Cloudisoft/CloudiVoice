/** Cloudisoft operators who can see cross-tenant system internals. */
export function isPlatformAdmin(email: string) {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}
