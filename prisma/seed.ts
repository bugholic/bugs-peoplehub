import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const DEMO_PASSWORD = "Password@123";

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
  console.log("Clearing existing data...");
  await db.regularizationRequest.deleteMany();
  await db.attendanceLog.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.leaveBalance.deleteMany();
  await db.holiday.deleteMany();
  await db.leaveType.deleteMany();
  await db.employee.deleteMany();
  await db.user.deleteMany();
  await db.department.deleteMany();
  await db.designation.deleteMany();
  await db.location.deleteMany();

  console.log("Seeding lookups...");
  const departments = await Promise.all(DEPARTMENTS.map((name) => db.department.create({ data: { name } })));
  const locations = await Promise.all(LOCATIONS.map((name) => db.location.create({ data: { name } })));
  const designations = await Promise.all(DESIGNATIONS.map((name) => db.designation.create({ data: { name } })));
  const leaveTypes = await Promise.all(LEAVE_TYPES.map((t) => db.leaveType.create({ data: t })));
  const deptByName = Object.fromEntries(departments.map((d) => [d.name, d]));
  const desigByName = Object.fromEntries(designations.map((d) => [d.name, d]));

  const year = new Date().getUTCFullYear();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log("Seeding holidays...");
  await db.holiday.createMany({
    data: [
      { date: new Date(`${year}-01-26T00:00:00Z`), name: "Republic Day" },
      { date: new Date(`${year}-08-15T00:00:00Z`), name: "Independence Day" },
      { date: new Date(`${year}-10-02T00:00:00Z`), name: "Gandhi Jayanti" },
      { date: new Date(`${year}-12-25T00:00:00Z`), name: "Christmas" },
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
    email: "admin@peoplehub.test",
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
  if (plans[1].withLogin) plans[1].email = "manager@peoplehub.test";

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
    let userId: string | undefined;
    if (p.withLogin) {
      const user = await db.user.create({ data: { email: p.email, passwordHash, role: p.role } });
      userId = user.id;
    }
    const joinDate = new Date();
    joinDate.setUTCFullYear(joinDate.getUTCFullYear() - 1);
    const employee = await db.employee.create({
      data: {
        empCode: p.empCode,
        firstName: p.first,
        lastName: p.last,
        email: p.email,
        joinDate,
        departmentId: deptByName[p.department].id,
        designationId: desigByName[p.designation].id,
        locationId: locations.find((l) => l.name === p.location)!.id,
        reportingManagerId: p.managerCode ? idByCode[p.managerCode] : null,
        userId,
      },
    });
    idByCode[p.empCode] = employee.id;
  }

  console.log("Seeding leave balances...");
  for (const empId of Object.values(idByCode)) {
    for (const t of leaveTypes) {
      if (t.code === "LOP") continue;
      await db.leaveBalance.create({
        data: { employeeId: empId, leaveTypeId: t.id, year, granted: t.annualQuota, used: 0 },
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
        data: { employeeId: empId, date: day, checkIn, checkOut, workedMinutes, status: "PRESENT" },
      });
    }
  }

  console.log("Done. Demo logins (password 'Password@123'):");
  console.log("  Admin:    admin@peoplehub.test");
  console.log("  Manager:  manager@peoplehub.test");
  console.log("  Employee: employee@peoplehub.test");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
