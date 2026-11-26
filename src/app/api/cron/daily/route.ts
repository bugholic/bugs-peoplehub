import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, route, unauthorized } from "@/lib/authz";
import { runDailyJobs } from "@/lib/jobs/daily";

// Many orgs × a few queries each: give it room beyond the default function timeout.
export const maxDuration = 300;

function authorized(header: string | null, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily jobs for every organization (src/lib/jobs/daily.ts): approval escalation (T12),
 * then the pending-approval digest (T11).
 * Scheduled by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`;
 * any other scheduler can call it the same way. Disabled (503) until CRON_SECRET is set.
 */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ApiError(503, "CRON_DISABLED", "Set CRON_SECRET to enable scheduled jobs");
  if (!authorized(req.headers.get("authorization"), secret)) throw unauthorized();
  return NextResponse.json({ results: await runDailyJobs() });
});
