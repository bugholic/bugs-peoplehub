import { apiFetch } from "./api-client";

export type PunchAction = "check-in" | "check-out";

export type WorkSession = {
  id: string;
  checkIn: string;
  checkOut: string | null;
  workMode: "OFFICE" | "REMOTE" | null;
  office: { id: string; name: string } | null;
};

export type PunchLog = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number;
  workMode: "OFFICE" | "REMOTE" | "HYBRID" | null;
  openSince: string | null;
  sessions: WorkSession[];
  remoteRequest: { id: string; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

export const WORK_MODE_LABEL = { OFFICE: "Office", REMOTE: "Remote", HYBRID: "Office + remote" } as const;

export type StoredLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  action: PunchAction;
};

export const LOCATION_STORAGE_KEY = "peoplehub.lastLocation";

/** Resolves null instead of rejecting when location is unsupported, denied or times out. */
export function currentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 10_000,
      // Always a fresh fix: a cached one could still say "office" after leaving it.
      maximumAge: 0,
    });
  });
}

export function readStoredLocation(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredLocation) : null;
  } catch {
    return null;
  }
}

function storeLocation(loc: StoredLocation) {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(loc));
  } catch {
    // Storage blocked (private mode etc.): the server still gets the location.
  }
}

/**
 * Check in or out with the device's current location. The location is kept in
 * localStorage and sent to the server, which decides office vs remote from it.
 * Without a location the punch still goes through and counts as remote.
 */
export async function punch(action: PunchAction): Promise<{ log: PunchLog; located: boolean }> {
  const pos = await currentPosition();
  let body: string | undefined;
  if (pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    storeLocation({ latitude, longitude, accuracy, capturedAt: new Date(pos.timestamp).toISOString(), action });
    body = JSON.stringify({ latitude, longitude, accuracy });
  }
  const log = await apiFetch<PunchLog>(`/api/attendance/${action}`, { method: "POST", body });
  return { log, located: !!pos };
}

/** A one-line confirmation for the punch that just happened. */
export function punchMessage(action: PunchAction, { log, located }: { log: PunchLog; located: boolean }): string {
  const noLocation = located ? "" : " Location was unavailable, so this counts as remote.";
  // The session this punch started or ended is always the latest one.
  const session = log.sessions.at(-1);
  if (action === "check-in") {
    return session?.workMode === "OFFICE" ? `Checked in at ${session.office?.name ?? "the office"}.` : `Checked in as remote.${noLocation}`;
  }
  if (session?.workMode === "REMOTE") return "Checked out. Your remote work request has been sent to HR.";
  return "Checked out. You can check in again any time today.";
}
