import Link from "next/link";
import { ForgotForm } from "../forms";

export const metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <div className="auth-card">
      <h1>Reset your password</h1>
      <p className="lede">Enter your account email and we&rsquo;ll send you a link to set a new password.</p>
      <ForgotForm />
      <p className="auth-alt">
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
