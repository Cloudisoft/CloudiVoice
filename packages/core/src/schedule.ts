/**
 * Calling-window logic in the lead's local time zone (never the server clock).
 * Defaults follow the common Indian practice of 9 AM – 9 PM.
 */

export interface CallingWindow {
  timezone: string;
  start: string; // "HH:MM" or "HH:MM:SS"
  end: string;
  days: number[]; // ISO weekday 1 = Monday … 7 = Sunday
}

function localParts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!) + 1;
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function isWithinCallingWindow(now: Date, w: CallingWindow): { open: boolean; nextOpenText: string; minutesUntilOpen: number } {
  const { minutes, weekday } = localParts(now, w.timezone);
  const start = toMinutes(w.start);
  const end = toMinutes(w.end);
  const dayOk = w.days.includes(weekday);
  if (dayOk && minutes >= start && minutes < end) return { open: true, nextOpenText: "now", minutesUntilOpen: 0 };
  // Find next opening.
  for (let d = 0; d < 8; d++) {
    const wd = ((weekday - 1 + d) % 7) + 1;
    if (!w.days.includes(wd)) continue;
    if (d === 0 && minutes >= start) continue;
    const until = d * 1440 + start - minutes;
    const label = d === 0 ? "today" : d === 1 ? "tomorrow" : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][wd - 1];
    const h = Math.floor(start / 60);
    const m = start % 60;
    const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
    return { open: false, nextOpenText: `${label} at ${time}`, minutesUntilOpen: until };
  }
  return { open: false, nextOpenText: "when calling days are configured", minutesUntilOpen: Infinity };
}

/** Clamp a requested callback time into the calling window. */
export function clampToWindow(when: Date, w: CallingWindow): Date {
  const state = isWithinCallingWindow(when, w);
  if (state.open || !Number.isFinite(state.minutesUntilOpen)) return when;
  return new Date(when.getTime() + state.minutesUntilOpen * 60_000);
}
