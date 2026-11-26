-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('MANUAL', 'QUOTA_CHANGE');

-- CreateTable
CREATE TABLE "LeaveBalanceAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "kind" "AdjustmentKind" NOT NULL DEFAULT 'MANUAL',
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveBalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveBalanceAdjustment_employeeId_year_idx" ON "LeaveBalanceAdjustment"("employeeId", "year");

-- CreateIndex
CREATE INDEX "LeaveBalanceAdjustment_organizationId_idx" ON "LeaveBalanceAdjustment"("organizationId");

-- AddForeignKey
ALTER TABLE "LeaveBalanceAdjustment" ADD CONSTRAINT "LeaveBalanceAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalanceAdjustment" ADD CONSTRAINT "LeaveBalanceAdjustment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalanceAdjustment" ADD CONSTRAINT "LeaveBalanceAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

