-- T14: configurable week-off pattern per organization, optional override per location (src/lib/week-off.ts).
ALTER TABLE "Location" ADD COLUMN     "weekOff" TEXT;

ALTER TABLE "Organization" ADD COLUMN     "weekOff" TEXT NOT NULL DEFAULT '0,6';
