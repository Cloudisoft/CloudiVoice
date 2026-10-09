import { Logo } from "@/components/brand/Logo";
import "./auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside" aria-hidden="true">
        <Logo />
        <div className="auth-quote">
          <p className="mono auth-kicker">agent ›</p>
          <p className="auth-line deva">नमस्ते! मैं आपकी क्या मदद कर सकती हूँ?</p>
          <p className="auth-line">Hello! How can I help you today?</p>
          <div className="auth-bars">
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} style={{ height: `${18 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4)) * 70)}%` }} />
            ))}
          </div>
        </div>
        <p className="auth-foot mono">CloudiVoice · A Cloudisoft product</p>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        {children}
      </main>
    </div>
  );
}
