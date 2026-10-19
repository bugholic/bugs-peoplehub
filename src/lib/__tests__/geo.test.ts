import { describe, expect, it } from "vitest";
import { distanceMeters, matchOffice } from "@/lib/geo";

const hq = { id: "hq", name: "HQ", latitude: 12.9716, longitude: 77.5946, radiusMeters: 200 };

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(hq, hq)).toBe(0);
  });

  it("matches a known distance (Bengaluru to Mumbai is ~840 km)", () => {
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    expect(distanceMeters(hq, mumbai) / 1000).toBeCloseTo(845, -1);
  });
});

describe("matchOffice", () => {
  // ~0.001° of latitude is ~111 m
  const near = { latitude: 12.9726, longitude: 77.5946 };
  const far = { latitude: 12.9816, longitude: 77.5946 };

  it("matches a point inside the radius", () => {
    expect(matchOffice(near, [hq])?.id).toBe("hq");
  });

  it("is null (remote) outside every radius", () => {
    expect(matchOffice(far, [hq])).toBeNull();
  });

  it("is null (remote) when there's no location", () => {
    expect(matchOffice(null, [hq])).toBeNull();
  });

  it("picks the nearest office when geofences overlap", () => {
    const annex = { id: "annex", name: "Annex", latitude: 12.9727, longitude: 77.5946, radiusMeters: 500 };
    expect(matchOffice(near, [hq, annex])?.id).toBe("annex");
  });
});
