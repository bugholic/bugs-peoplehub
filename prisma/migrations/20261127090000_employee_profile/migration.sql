-- T20: extended employee profile (src/lib/employee-profile.ts).

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "maritalStatus" TEXT,
    "bloodGroup" TEXT,
    "nationality" TEXT,
    "personalEmail" TEXT,
    "currentAddress" TEXT,
    "permanentAddress" TEXT,
    "emergencyName" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPhone" TEXT,
    "employmentType" TEXT,
    "probationEndDate" DATE,
    "noticePeriodDays" INTEGER,
    "panNumber" TEXT,
    "aadhaarNumber" TEXT,
    "passportNumber" TEXT,
    "bankAccountName" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_employeeId_key" ON "EmployeeProfile"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeProfile_organizationId_idx" ON "EmployeeProfile"("organizationId");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


