import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_attendance_admin";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { editAttendanceDay, importAttendance, listAttendanceEdits, normalizeTime, parseCsv } from "../attendance-admin";
import { checkIn, getMonth } from "../attendance";
import { createShift } from "../shifts";
import { parseIsoDate, zonedTimeToUtc } from "../dates";
import { attendanceEditSchema } from "../validators";

const NOW = zonedTimeToUtc("2026-11-20", "12:00"); // Fri 20 Nov, APP_TZ (no Organization row -> default zone)

describe("parseCsv / normalizeTime", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿employee,date,reason\r\nE1,2026-11-02,"forgot, again"\r\n\r\nE2,2026-11-03,"said ""hi"""\n');
    expect(rows).toEqual([
      ["employee", "date", "reason"],
      ["E1", "2026-11-02", "forgot, again"],
      ["E2", "2026-11-03", 'said "hi"'],
    ]);
  });
  it("normalizes times", () => {
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("09:05:30")).toBe("09:05");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("9.05")).toBeNull();
  });
  it("requires both times or neither", () => {
    const base = { employeeId: "e", date: "2026-11-02", reason: "fix" };
    expect(attendanceEditSchema.safeParse({ ...base, checkIn: "09:00", checkOut: "18:00" }).success).toBe(true);
    expect(attendanceEditSchema.safeParse({ ...base, checkIn: null, checkOut: null }).success).toBe(true);
    expect(attendanceEditSchema.safeParse({ ...base, checkIn: "09:00", checkOut: null }).success).toBe(false);
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.attendanceEdit.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.shift.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("admin attendance edit + import (T17, against the DB)", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await cleanup();
    await createShift({ name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, isDefault: true });
    for (const n of ["admin", "ann", "bob"]) {
      ids[n] = (await db.employee.create({ data: { empCode: n.toUpperCase(), firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2026-11-01") } })).id;
    }
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  const day = async (id: string, date: string) => (await getMonth(id, "2026-11")).find((d) => d.date === date)!;

  it("sets a day, applies shift rules, audits it and notifies", async () => {
    const edit = await editAttendanceDay({ employeeId: ids.ann, date: "2026-11-02", checkIn: "09:30", checkOut: "18:00", reason: "Biometric was down" }, ids.admin, NOW);
    expect(edit).toMatchObject({ before: null, source: "MANUAL", reason: "Biometric was down", createdBy: { name: "admin T" } });
    expect(edit.after).toMatchObject({ workedMinutes: 510 });

    expect(await day(ids.ann, "2026-11-02")).toMatchObject({ status: "PRESENT", workedMinutes: 510, lateMinutes: 30, edited: true });
    expect(await db.notification.count({ where: { recipientId: ids.ann, type: "ATTENDANCE_EDITED" } })).toBe(1);
  });

  it("replaces an existing day, recording the before", async () => {
    await checkIn(ids.ann, null, zonedTimeToUtc("2026-11-03", "09:00"));
    const edit = await editAttendanceDay({ employeeId: ids.ann, date: "2026-11-03", checkIn: "09:00", checkOut: "17:00", reason: "Left open" }, ids.admin, NOW);
    expect(edit.before).toMatchObject({ checkOut: null });
    expect(edit.after).toMatchObject({ workedMinutes: 480 });
    expect(await day(ids.ann, "2026-11-03")).toMatchObject({ workedMinutes: 480, openSince: null });
  });

  it("clears a day, and rejects no-ops, self-edits and future dates", async () => {
    const cleared = await editAttendanceDay({ employeeId: ids.ann, date: "2026-11-02", checkIn: null, checkOut: null, reason: "Entered by mistake" }, ids.admin, NOW);
    expect(cleared).toMatchObject({ after: null });
    expect(cleared.before).toMatchObject({ workedMinutes: 510 });
    expect((await day(ids.ann, "2026-11-02")).status).toBe("ABSENT");

    await expect(editAttendanceDay({ employeeId: ids.ann, date: "2026-11-02", checkIn: null, checkOut: null, reason: "again" }, ids.admin, NOW)).rejects.toMatchObject({ code: "NO_CHANGE" });
    await expect(editAttendanceDay({ employeeId: ids.admin, date: "2026-11-02", checkIn: "09:00", checkOut: "18:00", reason: "me" }, ids.admin, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(editAttendanceDay({ employeeId: ids.ann, date: "2026-11-23", checkIn: "09:00", checkOut: "18:00", reason: "future" }, ids.admin, NOW)).rejects.toMatchObject({ code: "FUTURE_DATE" });
    await expect(editAttendanceDay({ employeeId: ids.ann, date: "2026-10-30", checkIn: "09:00", checkOut: "18:00", reason: "pre-join" }, ids.admin, NOW)).rejects.toMatchObject({ code: "BEFORE_JOIN" });

    const trail = await listAttendanceEdits(ids.ann);
    expect(trail.map((t) => t.date).sort()).toEqual(["2026-11-02", "2026-11-02", "2026-11-03"]);
  });

  it("previews an import without writing, then applies it", async () => {
    const csv = [
      "employee,date,checkIn,checkOut,reason",
      "BOB,2026-11-04,09:00,18:00,",
      "bob@t.test,2026-11-05,9:10,18:10,Badge reader",
      "ANN,2026-11-03,09:00,17:00,", // identical to the stored day
    ].join("\n");
    const preview = await importAttendance(csv, ids.admin, { dryRun: true }, NOW);
    expect(preview.summary).toEqual({ total: 3, create: 2, update: 0, unchanged: 1, errors: 0 });
    expect(preview.applied).toBe(0);
    expect((await day(ids.bob, "2026-11-04")).status).toBe("ABSENT");

    const done = await importAttendance(csv, ids.admin, { dryRun: false, reason: "Nov biometric export" }, NOW);
    expect(done.applied).toBe(2);
    expect(await day(ids.bob, "2026-11-05")).toMatchObject({ status: "PRESENT", lateMinutes: 0, edited: true });
    const trail = await listAttendanceEdits(ids.bob);
    expect(trail.map((t) => [t.source, t.reason]).sort()).toEqual([["IMPORT", "Badge reader"], ["IMPORT", "Nov biometric export"]]);
    expect(await db.notification.count({ where: { recipientId: ids.bob, type: "ATTENDANCE_EDITED" } })).toBe(1); // one per person
  });

  it("applies nothing when any row has an error, and reports each one", async () => {
    const csv = [
      "Employee Code,Date,Check In,Check Out",
      "BOB,2026-11-06,09:00,18:00",
      "NOBODY,2026-11-06,09:00,18:00",
      "ANN,2026-13-40,09:00,18:00",
      "ANN,2026-11-09,9am,18:00",
      "ANN,2026-11-10,09:00,18:00",
      "ANN,2026-11-10,09:00,18:00",
      "ADMIN,2026-11-06,09:00,18:00",
    ].join("\n");
    const preview = await importAttendance(csv, ids.admin, { dryRun: true }, NOW);
    expect(preview.rows.map((r) => r.action)).toEqual(["create", "error", "error", "error", "create", "error", "error"]);
    expect(preview.rows[1].error).toMatch(/No employee/);
    expect(preview.rows[5].error).toMatch(/earlier in the file/);
    expect(preview.rows[6].error).toMatch(/own attendance/);
    await expect(importAttendance(csv, ids.admin, { dryRun: false }, NOW)).rejects.toMatchObject({ code: "IMPORT_HAS_ERRORS" });
    expect((await day(ids.bob, "2026-11-06")).status).toBe("ABSENT");
  });

  it("rejects a file without the needed columns", async () => {
    await expect(importAttendance("employee,date\nBOB,2026-11-06", ids.admin, { dryRun: true }, NOW)).rejects.toMatchObject({ code: "MISSING_COLUMN" });
  });
});
