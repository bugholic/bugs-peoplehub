import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, route, can } from "@/lib/authz";
import { parseQuery } from "@/lib/validators";
import { getMonth, summarize } from "@/lib/attendance";
import { formatMinutes } from "@/lib/dates";

const query = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM"),
  format: z.enum(["json", "csv"]).default("json"),
});

type Row = { empCode: string; name: string } & ReturnType<typeof summarize>;

function toCsv(rows: Row[]) {
  const header = "Emp Code,Name,Present,Absent,Leave,Holidays,Worked,Late Days,Early Exit Days,Overtime";
  const lines = rows.map((r) =>
    [
      r.empCode,
      r.name,
      r.present,
      r.absent,
      r.leave,
      r.holidays,
      formatMinutes(r.workedMinutes),
      r.lateDays,
      r.earlyExitDays,
      formatMinutes(r.overtimeMinutes),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export const GET = route(async (req) => {
  const session = await requirePermission("attendance.report_all", "attendance.report_team");
  const q = parseQuery(query, req);

  const team = await db.employee.findMany({
    where: can(session, "attendance.report_all") ? { status: "ACTIVE" } : { status: "ACTIVE", reportingManagerId: session.employeeId },
    select: { id: true, empCode: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });

  const rows = await Promise.all(
    team.map(async (e) => {
      const summary = summarize(await getMonth(e.id, q.month));
      return { empCode: e.empCode, name: `${e.firstName} ${e.lastName}`, ...summary };
    }),
  );

  if (q.format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="attendance-${q.month}.csv"`,
      },
    });
  }
  return NextResponse.json({ month: q.month, items: rows });
});
