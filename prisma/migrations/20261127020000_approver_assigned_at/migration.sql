-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "approverAssignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RegularizationRequest" ADD COLUMN     "approverAssignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- Existing requests: the clock starts when they were submitted.
UPDATE "LeaveRequest" SET "approverAssignedAt" = "createdAt";
UPDATE "RegularizationRequest" SET "approverAssignedAt" = "createdAt";
