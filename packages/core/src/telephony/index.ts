import { env } from "../env";
import { PrimaryCarrierAdapter } from "./adapters/plivo";
import { type TelephonyAdapter, TelephonyError } from "./types";

export * from "./types";

let cached: TelephonyAdapter | null | undefined;

/** The configured telephony connection, or null when none is set up. */
export function telephony(): TelephonyAdapter | null {
  if (cached !== undefined) return cached;
  const id = env.telephonyAuthId;
  const token = env.telephonyAuthToken;
  if (env.telephonyProvider === "plivo" && id && token) {
    cached = new PrimaryCarrierAdapter(id, token, env.voiceUrl);
  } else {
    cached = null;
  }
  return cached;
}

export function requireTelephony(): TelephonyAdapter {
  const t = telephony();
  if (!t) {
    throw new TelephonyError(
      "No telephony connection is configured yet. Add one under Settings → Telephony connection.",
      "telephony adapter not configured",
    );
  }
  return t;
}

/** Test hook. */
export function setTelephony(adapter: TelephonyAdapter | null | undefined) {
  cached = adapter;
}
