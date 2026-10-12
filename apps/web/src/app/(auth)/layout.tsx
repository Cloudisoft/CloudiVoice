import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import "./auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Logo />
        <div className="auth-quote" aria-hidden="true">
          <p className="mono auth-kicker">agent ›</p>
          <p className="auth-line deva">नमस्ते! मैं आपकी क्या मदद कर सकती हूँ?</p>
          <p className="auth-line">Hello! How can I help you today?</p>
          <div className="auth-bars">
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} style={{ height: `${18 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4)) * 70)}%` }} />
            ))}
          </div>
        </div>
        <p className="auth-foot mono" aria-hidden="true">
          CloudiVoice · A Cloudisoft product
        </p>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <div className="auth-back-row">
          <Link href="/" className="auth-back">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to homepage
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
