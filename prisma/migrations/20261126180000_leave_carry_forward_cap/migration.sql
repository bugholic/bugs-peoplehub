-- Cap on unused days carried into the next year; null = no cap.
ALTER TABLE "LeaveType" ADD COLUMN "maxCarryForward" DECIMAL(5,1);
