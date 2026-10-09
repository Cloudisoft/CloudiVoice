"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Logo } from "../brand/Logo";
import { Icon, type IconName } from "../ui/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  group: string;
  count?: number;
}

interface Props {
  items: NavItem[];
  user: { name: string; email: string };
  org: { id: string; name: string; role: string };
  orgs: { id: string; name: string }[];
  switchOrg: (orgId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function Sidebar({ items, user, org, orgs, switchOrg, logout }: Props) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => setOpen(false), [path]);

  const isActive = (href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));
  const groups = [...new Set(items.map((i) => i.group))];
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <div className="dash-topbar">
        <Logo href="/app" />
        <button className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls="side" onClick={() => setOpen((v) => !v)}>
          Menu
        </button>
      </div>
      <aside id="side" className={`side ${open ? "is-open" : ""}`} aria-label="Dashboard">
        <Logo href="/app" />
        <div className="org-switch">
          <span className="org-name" title={org.name}>
            {org.name}
          </span>
          <span className="org-role">{org.role}</span>
          {orgs.length > 1 && (
            <select
              className="select select-compact"
              aria-label="Switch organization"
              value={org.id}
              disabled={pending}
              onChange={(e) => start(async () => {
                await switchOrg(e.target.value);
                router.refresh();
              })}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <nav className="side-nav">
          {groups.map((g) => (
            <div key={g}>
              {g !== "main" && <div className="side-group">{g}</div>}
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <Link key={i.href} href={i.href} className="side-link" aria-current={isActive(i.href) ? "page" : undefined}>
                    <Icon name={i.icon} />
                    {i.label}
                    {i.count ? <span className="count">{i.count} live</span> : null}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="who">
              <b>{user.name}</b>
              <span>{user.email}</span>
            </span>
          </div>
          <form action={logout}>
            <button className="btn btn-quiet btn-sm" style={{ width: "100%", justifyContent: "flex-start" }}>
              <Icon name="logout" /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
