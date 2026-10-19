import type { Location } from "@/generated/prisma/client";
import { db } from "./db";
import { badRequest, conflict } from "./errors";

export function serializeLocation(l: Location) {
  return {
    id: l.id,
    name: l.name,
    latitude: l.latitude,
    longitude: l.longitude,
    radiusMeters: l.radiusMeters,
    isOffice: l.latitude !== null && l.longitude !== null,
  };
}

/** A geofence needs both coordinates, so they're set or cleared together. */
export function assertGeofencePair({ latitude, longitude }: { latitude?: number | null; longitude?: number | null }) {
  if (latitude === undefined && longitude === undefined) return;
  if (latitude === undefined || longitude === undefined || (latitude === null) !== (longitude === null)) {
    throw badRequest("Set latitude and longitude together", "INCOMPLETE_GEOFENCE");
  }
}

export async function assertUniqueLocationName(name: string) {
  const clash = await db.location.findUnique({ where: { name } });
  if (clash) throw conflict("A location with this name already exists", "DUPLICATE");
}
