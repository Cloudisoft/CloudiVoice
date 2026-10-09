import { ResetForm } from "../../forms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="auth-card">
      <h1>Choose a new password</h1>
      <p className="lede">After saving, you&rsquo;ll be signed out of other devices.</p>
      <ResetForm token={token} />
    </div>
  );
}
