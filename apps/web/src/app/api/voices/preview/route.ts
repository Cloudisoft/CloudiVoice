import { pcm16ToWav } from "@cloudivoice/core/audio";
import { getLanguage, VOICES } from "@cloudivoice/core/languages";
import { synthesize } from "@cloudivoice/core/speech";
import { rateLimit } from "@cloudivoice/core/services/system";
import { currentUser } from "@/lib/session";

const cache = new Map<string, Uint8Array>();
const LINES: Record<string, string> = {
  "hi-IN": "नमस्ते! मैं आपकी AI सहायक हूँ। बताइए, आज मैं आपकी क्या मदद कर सकती हूँ?",
  "en-IN": "Hello! I'm your AI assistant. How can I help you today?",
};

/** Short voice sample for the agent builder (signed-in users only). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.orgId) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const voice = url.searchParams.get("voice") ?? "";
  const lang = url.searchParams.get("lang") ?? "hi-IN";
  const pace = Math.min(1.3, Math.max(0.8, Number(url.searchParams.get("pace") ?? 1)));
  if (!VOICES.some((v) => v.id === voice) || getLanguage(lang)?.status !== "available") return new Response("Bad request", { status: 400 });
  const key = `${voice}:${lang}:${pace.toFixed(2)}`;
  let wav = cache.get(key);
  if (!wav) {
    if (!(await rateLimit(`preview:${user.userId}`, 30, 3600)).ok) return new Response("Too many previews", { status: 429 });
    try {
      const { pcm, sampleRate } = await synthesize(LINES[lang] ?? LINES["en-IN"]!, { language: lang, voice, pace, sampleRate: 22050 });
      wav = pcm16ToWav(pcm, sampleRate);
      cache.set(key, wav);
    } catch {
      return new Response("Voice preview unavailable", { status: 503 });
    }
  }
  return new Response(wav as BodyInit, { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" } });
}
