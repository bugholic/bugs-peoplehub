-- AlterEnum
ALTER TYPE "WorkMode" ADD VALUE 'HYBRID';

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "attendanceLogId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "workMode" "WorkMode",
    "officeLocationId" TEXT,
    "checkInLatitude" DOUBLE PRECISION,
    "checkInLongitude" DOUBLE PRECISION,
    "checkInAccuracy" DOUBLE PRECISION,
    "checkOutLatitude" DOUBLE PRECISION,
    "checkOutLongitude" DOUBLE PRECISION,
    "checkOutAccuracy" DOUBLE PRECISION,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_attendanceLogId_idx" ON "AttendanceSession"("attendanceLogId");

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_attendanceLogId_fkey" FOREIGN KEY ("attendanceLogId") REFERENCES "AttendanceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing check-in becomes that day's single session, carrying its location data.
INSERT INTO "AttendanceSession" ("id", "attendanceLogId", "checkIn", "checkOut", "workMode", "officeLocationId",
    "checkInLatitude", "checkInLongitude", "checkInAccuracy", "checkOutLatitude", "checkOutLongitude", "checkOutAccuracy")
SELECT 'bf_' || "id", "id", "checkIn", "checkOut", "workMode", "officeLocationId",
    "checkInLatitude", "checkInLongitude", "checkInAccuracy", "checkOutLatitude", "checkOutLongitude", "checkOutAccuracy"
FROM "AttendanceLog"
WHERE "checkIn" IS NOT NULL;

-- AlterTable
ALTER TABLE "RemoteWorkRequest" ADD COLUMN     "remoteMinutes" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing requests cover a single remote session.
UPDATE "RemoteWorkRequest"
SET "remoteMinutes" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("checkOut" - "checkIn")) / 60))::INTEGER;

-- DropForeignKey
ALTER TABLE "AttendanceLog" DROP CONSTRAINT "AttendanceLog_officeLocationId_fkey";

-- AlterTable (moved to AttendanceSession above)
ALTER TABLE "AttendanceLog" DROP COLUMN "checkInAccuracy",
DROP COLUMN "checkInLatitude",
DROP COLUMN "checkInLongitude",
DROP COLUMN "checkOutAccuracy",
DROP COLUMN "checkOutLatitude",
DROP COLUMN "checkOutLongitude",
DROP COLUMN "officeLocationId";
