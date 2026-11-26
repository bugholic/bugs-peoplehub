"use client";

import { setDisplayTimeZone } from "@/lib/dates";

/**
 * Makes the signed-in person's zone the default for todayIso / formatTime / zonedTimeToUtc in
 * the browser. Rendered before the page in the app layout and set during render (idempotent),
 * so it's in place before any child formats a time.
 */
export function TimeZoneScope({ timeZone }: { timeZone: string }) {
  setDisplayTimeZone(timeZone);
  return null;
}
