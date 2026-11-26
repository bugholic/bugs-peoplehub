import { escalateStaleApprovals } from "../approvals";
import { remindPendingApprovals } from "./approval-reminders";
import { forEachOrganization } from "./run";
import { autoCloseOpenSessions, flagMissingAttendance } from "./attendance";

/**
 * Everything the daily cron runs, per organization, in order:
 *  1. escalation (T12): repair requests stuck on deactivated approvers, move stale ones up;
 *  2. reminders (T11): digest of what's pending, so it reflects step 1's new approvers;
 *  3. attendance (T16): close forgotten check-outs, then flag last working day's missing attendance.
 */
export async function runDailyJobs(now = new Date()) {
  return forEachOrganization("daily", async (organizationId) => {
    const { repaired, escalated } = await escalateStaleApprovals(now);
    const reminded = await remindPendingApprovals(organizationId, now);
    const autoClosed = await autoCloseOpenSessions(now);
    const missing = await flagMissingAttendance(now);
    return { repaired, escalated, reminded, autoClosed, missing };
  });
}
