-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "timeZone" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

