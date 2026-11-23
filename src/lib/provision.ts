import { currentUser } from "@clerk/nextjs/server";
import type { Employee } from "@/generated/prisma/client";
import { db } from "./db";

export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual Leave", code: "CL", annualQuota: 12, paid: true, carryForward: false, allowHalfDay: true },
  { name: "Sick Leave", code: "SL", annualQuota: 10, paid: true, carryForward: false, allowHalfDay: true },
  { name: "Earned Leave", code: "EL", annualQuota: 15, paid: true, carryForward: true, allowHalfDay: true },
  { name: "Loss of Pay", code: "LOP", annualQuota: 0, paid: false, carryForward: false, allowHalfDay: false },
];

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";
const todayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

/** A brand-new organization starts with the standard leave types; it manages everything else itself. */
async function ensureOrgDefaults() {
  if ((await db.leaveType.count()) > 0) return;
  try {
    await db.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e; // a concurrent first request already seeded them
  }
}

/**
 * Called the first time a Clerk org member reaches the app. Links them to an
 * existing directory record (same verified email, not yet linked) or creates one.
 * Returns null when there's no verified email to identify them by, or the email
 * already belongs to a different, linked employee.
 */
export async function provisionEmployee(clerkUserId: string): Promise<Employee | null> {
  const user = await currentUser();
  const primary = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  if (!user || !primary || primary.verification?.status !== "verified") return null;
  const email = primary.emailAddress.toLowerCase();

  await ensureOrgDefaults();

  const unlinked = await db.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, clerkUserId: null },
  });
  if (unlinked) return db.employee.update({ where: { id: unlinked.id }, data: { clerkUserId } });

  const types = await db.leaveType.findMany({ where: { active: true, annualQuota: { gt: 0 } } });
  const year = new Date().getUTCFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    const empCode = `EMP${String((await db.employee.count()) + 1 + attempt).padStart(3, "0")}`;
    try {
      return await db.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            empCode,
            firstName: user.firstName || email.split("@")[0],
            lastName: user.lastName ?? "",
            email,
            joinDate: todayUtc(),
            clerkUserId,
          },
        });
        if (types.length) {
          await tx.leaveBalance.createMany({
            data: types.map((t) => ({ employeeId: employee.id, leaveTypeId: t.id, year, granted: t.annualQuota, used: 0 })),
          });
        }
        return employee;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Lost a race for this user (concurrent first requests) -> use the winner's row.
      const mine = await db.employee.findFirst({ where: { clerkUserId } });
      if (mine) return mine;
      // Otherwise empCode clashed (retry with next number) or the email is taken by another linked employee.
      if (await db.employee.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })) return null;
    }
  }
  return null;
}
