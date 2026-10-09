import Link from "next/link";
import { redirect } from "next/navigation";
import { getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { currentUser } from "@/lib/session";
import { SignupForm } from "../forms";

export const metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUser()) redirect("/app");
  const sp = await searchParams;
  const scenario = sp.scenario && getDemoScenario(sp.scenario) ? sp.scenario : undefined;
  const lang = sp.lang === "hi-IN" || sp.lang === "en-IN" ? sp.lang : undefined;
  return (
    <div className="auth-card">
      <h1>Create your free account</h1>
      <p className="lede">Build and test your first voice agent in minutes. No card required.</p>
      <SignupForm scenario={scenario} lang={lang} scenarioLabel={scenario ? getDemoScenario(scenario)?.label : undefined} />
      <p className="auth-alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
