/**
 * Central, server-only configuration. Every secret is read from the host
 * environment; nothing here is ever shipped to a browser bundle.
 */

function read(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function int(name: string, fallback: number): number {
  const v = read(name);
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get nodeEnv() {
    return read("NODE_ENV") ?? "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get databaseUrl() {
    return read("DATABASE_URL") ?? "postgres://postgres@localhost:5432/cloudivoice";
  },
  /** Public origin of the web app, e.g. https://voice.cloudisoft.com */
  get appUrl() {
    return (read("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** Public origin of the voice gateway (must be reachable by the carrier). */
  get voiceUrl() {
    return (read("VOICE_PUBLIC_URL") ?? "http://localhost:8080").replace(/\/$/, "");
  },
  /** 32+ char secret for session/link signing. */
  get appSecret() {
    const v = read("APP_SECRET");
    if (!v) {
      if (this.isProduction) throw new Error("APP_SECRET must be set in production");
      return "dev-only-insecure-secret-change-me-0123456789";
    }
    return v;
  },
  /** 32-byte key (base64 or hex) used to encrypt credentials at rest. */
  get encryptionKey() {
    return read("ENCRYPTION_KEY");
  },

  // ---- Telephony connection (provider details stay server-side) ----
  get telephonyProvider() {
    return read("TELEPHONY_PROVIDER") ?? "none";
  },
  get telephonyAuthId() {
    return read("TELEPHONY_AUTH_ID");
  },
  get telephonyAuthToken() {
    return read("TELEPHONY_AUTH_TOKEN");
  },
  /** "mulaw-8k" (default) or "l16-16k" for wideband carriers. */
  get telephonyStreamFormat(): "mulaw-8k" | "l16-16k" {
    return read("TELEPHONY_STREAM_FORMAT") === "l16-16k" ? "l16-16k" : "mulaw-8k";
  },

  // ---- Speech + reasoning stack ----
  get speechApiKey() {
    return read("SPEECH_API_KEY");
  },
  get speechApiBase() {
    return (read("SPEECH_API_BASE") ?? "https://api.sarvam.ai").replace(/\/$/, "");
  },
  get sttModel() {
    return read("STT_MODEL") ?? "saaras:v3";
  },
  get ttsModel() {
    return read("TTS_MODEL") ?? "bulbul:v3";
  },
  get anthropicApiKey() {
    return read("ANTHROPIC_API_KEY");
  },
  get llmModel() {
    return read("LLM_MODEL") ?? "claude-haiku-4-5";
  },
  get llmEffort(): "low" | "medium" | "high" {
    const v = read("LLM_EFFORT");
    return v === "medium" || v === "high" ? v : "low";
  },

  // ---- Public demo guard rails ----
  get demoMaxSeconds() {
    return int("DEMO_MAX_SECONDS", 120);
  },
  get demoSessionsPerIpPerDay() {
    return int("DEMO_SESSIONS_PER_IP_PER_DAY", 5);
  },
  get demoDailyCeilingSeconds() {
    return int("DEMO_DAILY_CEILING_SECONDS", 4 * 60 * 60);
  },

  // ---- Email ----
  get smtpUrl() {
    return read("SMTP_URL");
  },
  get mailFrom() {
    return read("MAIL_FROM") ?? "CloudiVoice <no-reply@cloudisoft.com>";
  },

  // ---- Storage ----
  get storageDir() {
    return read("STORAGE_DIR") ?? "./storage";
  },

  // ---- Workers ----
  get workerId() {
    return read("WORKER_ID") ?? `worker-${process.pid}`;
  },
  get orgMaxConcurrency() {
    return int("ORG_MAX_CONCURRENCY", 10);
  },
};

export type Env = typeof env;

/** What the live speech stack can actually do right now. */
export function liveStackStatus() {
  const speech = Boolean(env.speechApiKey);
  const llm = Boolean(env.anthropicApiKey);
  const telephony =
    env.telephonyProvider !== "none" && Boolean(env.telephonyAuthId && env.telephonyAuthToken);
  return {
    speech,
    llm,
    telephony,
    browserDemo: speech && llm,
    phoneCalls: speech && llm && telephony,
  };
}
