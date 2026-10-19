export type GeoPoint = { latitude: number; longitude: number };

export type Geofence = GeoPoint & { id: string; name: string; radiusMeters: number };

const EARTH_RADIUS_METERS = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest office whose geofence contains `point`, or null when it's outside all of them (remote). */
export function matchOffice<T extends Geofence>(point: GeoPoint | null | undefined, offices: T[]): T | null {
  if (!point) return null;
  let best: { office: T; distance: number } | null = null;
  for (const office of offices) {
    const distance = distanceMeters(point, office);
    if (distance <= office.radiusMeters && (!best || distance < best.distance)) best = { office, distance };
  }
  return best?.office ?? null;
}
