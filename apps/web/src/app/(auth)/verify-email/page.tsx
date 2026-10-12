import Link from "next/link";
import { ResendVerification } from "../forms";

export const metadata = { title: "Confirm your email" };

export default async function CheckInboxPage({ searchParams }: { searchParams: Promise<{ email?: string; dev?: string }> }) {
  const sp = await searchParams;
  const email = sp.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sp.email) ? sp.email : "";
  // Development without an email server: show the link that would have been emailed.
  const dev = process.env.NODE_ENV !== "production" && sp.dev?.startsWith("http") ? sp.dev : null;
  return (
    <div className="auth-card">
      <div className="inbox-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m3 7 9 6 9-6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
      <h1>Check your inbox</h1>
      <p className="lede">
        We sent a confirmation link to {email ? <b>{email}</b> : "your email address"}. Click it to activate your account — you&rsquo;ll go straight to setting up your first agent.
      </p>
      {dev && (
        <div className="notice notice-warn">
          <span>
            Development mode (no email server configured):{" "}
            <a className="link" href={dev}>
              open the confirmation link
            </a>
          </span>
        </div>
      )}
      <ul className="inbox-tips">
        <li>The link works for 48 hours.</li>
        <li>Can&rsquo;t find it? Check spam or promotions, or resend it below.</li>
      </ul>
      {email && <ResendVerification email={email} />}
      <p className="auth-alt">
        Wrong address? <Link href="/signup">Sign up again</Link> · <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
