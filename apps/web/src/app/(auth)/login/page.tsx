import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { LoginForm } from "../forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUser()) redirect("/app");
  const sp = await searchParams;
  return (
    <div className="auth-card">
      <h1>Welcome back</h1>
      <p className="lede">Sign in to manage your agents, campaigns and calls.</p>
      <LoginForm next={sp.next} notice={sp.reset ? "Your password was updated. Sign in with your new password." : undefined} />
      <p className="auth-alt">
        New to CloudiVoice? <Link href="/signup">Create a free account</Link>
      </p>
    </div>
  );
}
