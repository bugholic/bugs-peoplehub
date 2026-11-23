-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_userId_fkey";

-- DropIndex
DROP INDEX "Department_name_key";

-- DropIndex
DROP INDEX "Designation_name_key";

-- DropIndex
DROP INDEX "Employee_email_key";

-- DropIndex
DROP INDEX "Employee_empCode_key";

-- DropIndex
DROP INDEX "Employee_userId_key";

-- DropIndex
DROP INDEX "LeaveType_code_key";

-- DropIndex
DROP INDEX "LeaveType_name_key";

-- DropIndex
DROP INDEX "Location_name_key";

-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "AttendanceSession" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "userId",
ADD COLUMN     "clerkUserId" TEXT,
ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "LeaveBalance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "RegularizationRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "RemoteWorkRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "Role";

-- CreateIndex
CREATE INDEX "AttendanceLog_organizationId_idx" ON "AttendanceLog"("organizationId");

-- CreateIndex
CREATE INDEX "AttendanceSession_organizationId_idx" ON "AttendanceSession"("organizationId");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Designation_organizationId_idx" ON "Designation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_organizationId_name_key" ON "Designation"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_empCode_key" ON "Employee"("organizationId", "empCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_email_key" ON "Employee"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_clerkUserId_key" ON "Employee"("organizationId", "clerkUserId");

-- CreateIndex
CREATE INDEX "Holiday_organizationId_idx" ON "Holiday"("organizationId");

-- CreateIndex
CREATE INDEX "LeaveBalance_organizationId_idx" ON "LeaveBalance"("organizationId");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_idx" ON "LeaveRequest"("organizationId");

-- CreateIndex
CREATE INDEX "LeaveType_organizationId_idx" ON "LeaveType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_organizationId_name_key" ON "LeaveType"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_organizationId_code_key" ON "LeaveType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_organizationId_name_key" ON "Location"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RegularizationRequest_organizationId_idx" ON "RegularizationRequest"("organizationId");

-- CreateIndex
CREATE INDEX "RemoteWorkRequest_organizationId_idx" ON "RemoteWorkRequest"("organizationId");

