import { ConfirmEmail } from "../../forms";

export const metadata = { title: "Confirming your email" };

export default async function ConfirmEmailPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ next?: string }> }) {
  const { token } = await params;
  const { next } = await searchParams;
  return (
    <div className="auth-card">
      <h1>Confirming your email</h1>
      <p className="lede">One moment — we&rsquo;re activating your account and taking you to setup.</p>
      <ConfirmEmail token={token} next={next?.startsWith("/") && !next.startsWith("//") ? next : undefined} />
    </div>
  );
}
