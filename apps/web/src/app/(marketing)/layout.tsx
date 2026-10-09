import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { currentUser } from "@/lib/session";
import "./marketing.css";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <div className="site">
      <div className="signal-bar" aria-hidden="true">
        <span className="signal-ticks" />
        <span className="signal-label mono">
          <i /> listening
        </span>
        <span className="signal-ticks" />
      </div>
      <SiteHeader signedIn={Boolean(user)} />
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <Image src="/brand/cloudisoft-logo.png" alt="Cloudisoft" width={180} height={106} className="footer-logo" />
            <p>CloudiVoice is an AI voice agent platform by Cloudisoft, built in India for Indian businesses.</p>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            <div>
              <span className="label">Product</span>
              <Link href="/#platform">Platform</Link>
              <Link href="/#solutions">Solutions</Link>
              <Link href="/#pricing">Pricing</Link>
              <Link href="/#demo">Live demo</Link>
            </div>
            <div>
              <span className="label">Resources</span>
              <Link href="/resources">Guides</Link>
              <Link href="/resources#campaigns">Running a campaign</Link>
              <Link href="/resources#results">Reading results</Link>
            </div>
            <div>
              <span className="label">Account</span>
              <Link href="/signup">Start free</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </nav>
        </div>
        <div className="container footer-base mono">
          <span>© {new Date().getFullYear()} Cloudisoft. All rights reserved.</span>
          <span>Sample calls on this site use synthesized voices and fictional businesses.</span>
        </div>
      </footer>
    </div>
  );
}
