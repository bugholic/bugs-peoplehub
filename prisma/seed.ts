import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

/**
 * Demo data for ONE organization. Usage:
 *   SEED_ORG_ID=org_xxx [SEED_ADMIN_EMAIL=you@company.com] npm run db:seed
 * (org id is shown in the Clerk Dashboard -> Organizations). Only that org's rows are replaced.
 * Employees have no login; each person is linked automatically when they join the org
 * with a matching verified email, so set SEED_ADMIN_EMAIL to your own address.
 */
const ORG = process.env.SEED_ORG_ID;
if (!ORG) throw new Error("Set SEED_ORG_ID to the Clerk organization id to seed");
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@peoplehub.test").toLowerCase();

const DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Human Resources", "Finance"];
const LOCATIONS = ["Bengaluru HQ", "Remote"];
const DESIGNATIONS = [
  "Chief Executive Officer",
  "Engineering Manager",
  "Senior Software Engineer",
  "Software Engineer",
  "Sales Manager",
  "Sales Executive",
  "Marketing Specialist",
  "HR Manager",
  "HR Executive",
  "Finance Analyst",
];
const LEAVE_TYPES = [
  { name: "Casual Leave", code: "CL", annualQuota: 12, paid: true, carryForward: false, allowHalfDay: true },
  { name: "Sick Leave", code: "SL", annualQuota: 10, paid: true, carryForward: false, allowHalfDay: true },
  { name: "Earned Leave", code: "EL", annualQuota: 15, paid: true, carryForward: true, allowHalfDay: true },
  { name: "Loss of Pay", code: "LOP", annualQuota: 0, paid: false, carryForward: false, allowHalfDay: false },
];

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna",
  "Ishaan", "Rohan", "Ananya", "Diya", "Priya", "Isha", "Meera", "Kavya",
  "Aditi", "Riya", "Sneha", "Pooja", "Rahul", "Karan", "Nikhil", "Varun",
  "Pranav", "Tanvi", "Neha", "Divya", "Amit", "Sanjay",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Iyer", "Nair", "Gupta", "Reddy", "Patel", "Mehta",
  "Rao", "Singh", "Kapoor", "Joshi", "Desai", "Pillai", "Chopra",
];

function nameAt(i: number) {
  return { first: FIRST_NAMES[i % FIRST_NAMES.length], last: LAST_NAMES[i % LAST_NAMES.length] };
}

function workdaysBack(from: Date, count: number): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(new Date(d));
  }
  return out.reverse();
}

async function main() {
  console.log(`Clearing existing data for ${ORG}...`);
  const where = { organizationId: ORG };
  await db.remoteWorkRequest.deleteMany({ where });
  await db.regularizationRequest.deleteMany({ where });
  await db.attendanceSession.deleteMany({ where });
  await db.attendanceLog.deleteMany({ where });
  await db.leaveRequest.deleteMany({ where });
  await db.leaveBalance.deleteMany({ where });
  await db.holiday.deleteMany({ where });
  await db.leaveType.deleteMany({ where });
  await db.employee.deleteMany({ where });
  await db.department.deleteMany({ where });
  await db.designation.deleteMany({ where });
  await db.location.deleteMany({ where });

  console.log("Seeding lookups...");
  const departments = await Promise.all(DEPARTMENTS.map((name) => db.department.create({ data: { name, organizationId: ORG } })));
  const locations = await Promise.all(LOCATIONS.map((name) => db.location.create({ data: { name, organizationId: ORG } })));
  const designations = await Promise.all(DESIGNATIONS.map((name) => db.designation.create({ data: { name, organizationId: ORG } })));
  const leaveTypes = await Promise.all(LEAVE_TYPES.map((t) => db.leaveType.create({ data: { ...t, organizationId: ORG } })));
  const deptByName = Object.fromEntries(departments.map((d) => [d.name, d]));
  const desigByName = Object.fromEntries(designations.map((d) => [d.name, d]));

  const year = new Date().getUTCFullYear();

  console.log("Seeding holidays...");
  await db.holiday.createMany({
    data: [
      { date: new Date(`${year}-01-26T00:00:00Z`), name: "Republic Day", organizationId: ORG },
      { date: new Date(`${year}-08-15T00:00:00Z`), name: "Independence Day", organizationId: ORG },
      { date: new Date(`${year}-10-02T00:00:00Z`), name: "Gandhi Jayanti", organizationId: ORG },
      { date: new Date(`${year}-12-25T00:00:00Z`), name: "Christmas", organizationId: ORG },
    ],
  });

  type Plan = {
    empCode: string;
    first: string;
    last: string;
    email: string;
    department: string;
    designation: string;
    location: string;
    role: "ADMIN" | "MANAGER" | "EMPLOYEE";
    managerCode: string | null;
    withLogin: boolean;
  };

  const plans: Plan[] = [];
  plans.push({
    empCode: "EMP001",
    first: "Asha",
    last: "Admin",
    email: ADMIN_EMAIL,
    department: "Human Resources",
    designation: "Chief Executive Officer",
    location: "Bengaluru HQ",
    role: "ADMIN",
    managerCode: null,
    withLogin: true,
  });

  const managerDepts = ["Engineering", "Sales", "Marketing", "Human Resources", "Finance"];
  const managerDesig: Record<string, string> = {
    Engineering: "Engineering Manager",
    Sales: "Sales Manager",
    Marketing: "Marketing Specialist",
    "Human Resources": "HR Manager",
    Finance: "Finance Analyst",
  };
  managerDepts.forEach((dept, i) => {
    const { first, last } = nameAt(i);
    plans.push({
      empCode: `EMP00${i + 2}`,
      first,
      last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@peoplehub.test`,
      department: dept,
      designation: managerDesig[dept],
      location: LOCATIONS[i % LOCATIONS.length],
      role: "MANAGER",
      managerCode: "EMP001",
      withLogin: dept === "Engineering",
    });
  });

  const deptCodes = plans.filter((p) => p.managerCode === "EMP001").reduce<Record<string, string>>((acc, p) => {
    acc[p.department] = p.empCode;
    return acc;
  }, {});

  const icDesig: Record<string, string[]> = {
    Engineering: ["Senior Software Engineer", "Software Engineer"],
    Sales: ["Sales Executive"],
    Marketing: ["Marketing Specialist"],
    "Human Resources": ["HR Executive"],
    Finance: ["Finance Analyst"],
  };

  let codeN = plans.length + 1;
  let firstEmployeeDone = false;
  while (plans.length < 30) {
    const dept = managerDepts[codeN % managerDepts.length];
    const options = icDesig[dept];
    const designation = options[codeN % options.length];
    const { first, last } = nameAt(codeN);
    const empCode = `EMP${String(codeN).padStart(3, "0")}`;
    const withLogin = !firstEmployeeDone && dept === "Engineering";
    if (withLogin) firstEmployeeDone = true;
    plans.push({
      empCode,
      first,
      last,
      email: withLogin ? "employee@peoplehub.test" : `${first.toLowerCase()}.${last.toLowerCase()}${codeN}@peoplehub.test`,
      department: dept,
      designation,
      location: LOCATIONS[codeN % LOCATIONS.length],
      role: "EMPLOYEE",
      managerCode: deptCodes[dept],
      withLogin,
    });
    codeN++;
  }

  console.log(`Seeding ${plans.length} employees...`);
  const idByCode: Record<string, string> = {};
  for (const p of plans) {
    const joinDate = new Date();
    joinDate.setUTCFullYear(joinDate.getUTCFullYear() - 1);
    const employee = await db.employee.create({
      data: {
        organizationId: ORG,
        empCode: p.empCode,
        firstName: p.first,
        lastName: p.last,
        email: p.email,
        joinDate,
        departmentId: deptByName[p.department].id,
        designationId: desigByName[p.designation].id,
        locationId: locations.find((l) => l.name === p.location)!.id,
        reportingManagerId: p.managerCode ? idByCode[p.managerCode] : null,
      },
    });
    idByCode[p.empCode] = employee.id;
  }

  console.log("Seeding leave balances...");
  for (const empId of Object.values(idByCode)) {
    for (const t of leaveTypes) {
      if (t.code === "LOP") continue;
      await db.leaveBalance.create({
        data: { organizationId: ORG, employeeId: empId, leaveTypeId: t.id, year, granted: t.annualQuota, used: 0 },
      });
    }
  }

  console.log("Seeding last month's attendance...");
  const days = workdaysBack(new Date(), 20);
  for (const [idx, empId] of Object.values(idByCode).entries()) {
    for (const [dayIdx, day] of days.entries()) {
      // Occasional absence so the dashboard shows a realistic mix.
      if ((idx + dayIdx) % 11 === 0) continue;
      const checkIn = new Date(day);
      checkIn.setUTCHours(3, 25 + (idx % 20), 0, 0); // ~09:00-09:20 IST
      const checkOut = new Date(day);
      checkOut.setUTCHours(12, 30 + (idx % 15), 0, 0); // ~18:00-18:15 IST
      const workedMinutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000);
      await db.attendanceLog.create({
        data: { organizationId: ORG, employeeId: empId, date: day, checkIn, checkOut, workedMinutes, status: "PRESENT" },
      });
    }
  }

  console.log(`Done. Sign in to this org with ${ADMIN_EMAIL} to be linked to the admin record (assign the Admin role in Clerk).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
