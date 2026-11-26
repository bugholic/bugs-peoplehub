-- T17: audited admin attendance edits / CSV import (src/lib/attendance-admin.ts).
-- CreateEnum
CREATE TYPE "AttendanceEditSource" AS ENUM ('MANUAL', 'IMPORT');

-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN     "edited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AttendanceEdit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "source" "AttendanceEditSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceEdit_employeeId_date_idx" ON "AttendanceEdit"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceEdit_organizationId_idx" ON "AttendanceEdit"("organizationId");

-- AddForeignKey
ALTER TABLE "AttendanceEdit" ADD CONSTRAINT "AttendanceEdit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEdit" ADD CONSTRAINT "AttendanceEdit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


