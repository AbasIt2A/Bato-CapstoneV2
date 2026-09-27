export interface Facility {
  code: string;
  name: string;
  level: 1 | 2 | 3;
  address: string;
  barangay: string;
  barangayPsgc: string;
  city: string;
  cityPsgc: string;
  province: string;
  lat: number;
  lon: number;
  phone: string | null;
  email: string | null;
  licenseValidUntil: string | null;
}

export interface Place {
  code: string;
  name: string;
  province: string;
  lat: number;
  lon: number;
}

type Ring = number[][];
type Polygon = Ring[];

export type RegionGeometry =
  | { type: "Polygon"; coordinates: Polygon }
  | { type: "MultiPolygon"; coordinates: Polygon[] };

export interface Directory {
  snapshotDate: string;
  sourceUrl: string;
  facilities: Facility[];
  places: Place[];
  regionGeometry?: RegionGeometry;
  placeGeometries?: { code: string; geometry: RegionGeometry }[];
  coverageGeometries?: { cityPsgc: string; geometry: RegionGeometry }[];
}

export interface FacilityResult extends Facility {
  distanceKm: number;
}

export interface SearchResult {
  snapshotDate: string;
  status: "ok" | "outside_region";
  locationLabel: string;
  localPrimaryCount: number;
  localSecondaryCount: number;
  facilities: FacilityResult[];
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) *
      Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (lon - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-10 &&
      lon >= Math.min(xi, xj) && lon <= Math.max(xi, xj) &&
      lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)
    ) return true;
    if (
      (yi > lat) !== (yj > lat) &&
      lon < (xj - xi) * (lat - yi) / (yj - yi) + xi
    ) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  return inRing(lon, lat, polygon[0]) &&
    !polygon.slice(1).some((hole) => inRing(lon, lat, hole));
}

function inGeometry(
  lon: number,
  lat: number,
  geometry: RegionGeometry,
): boolean {
  if (geometry?.type === "Polygon") {
    return inPolygon(lon, lat, geometry.coordinates);
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => inPolygon(lon, lat, polygon));
  }
  return false;
}

export function searchDirectory(
  directory: Directory,
  input: unknown,
): SearchResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid search request");
  }
  const request = input as Record<string, unknown>;
  if (typeof request.includeLevel1 !== "boolean") {
    throw new TypeError("includeLevel1 must be a boolean");
  }
  const hasCity = Object.hasOwn(request, "cityCode");
  const hasLatitude = Object.hasOwn(request, "latitude");
  const hasLongitude = Object.hasOwn(request, "longitude");
  if (hasCity === (hasLatitude || hasLongitude)) {
    throw new TypeError("Provide either cityCode or coordinates");
  }

  let place: Place | undefined;
  let latitude: number;
  let longitude: number;
  if (hasCity) {
    if (typeof request.cityCode !== "string" || !request.cityCode) {
      throw new TypeError("Invalid cityCode");
    }
    place = directory.places.find((candidate) =>
      candidate.code === request.cityCode
    );
    if (!place) throw new RangeError("Unknown cityCode");
    latitude = place.lat;
    longitude = place.lon;
  } else {
    if (
      typeof request.latitude !== "number" ||
      !Number.isFinite(request.latitude) ||
      request.latitude < -90 || request.latitude > 90 ||
      typeof request.longitude !== "number" ||
      !Number.isFinite(request.longitude) ||
      request.longitude < -180 || request.longitude > 180
    ) {
      throw new RangeError("Invalid coordinates");
    }
    latitude = request.latitude;
    longitude = request.longitude;
    place = directory.places.reduce<Place | undefined>(
      (best, candidate) =>
        !best || km(latitude, longitude, candidate.lat, candidate.lon) <
            km(latitude, longitude, best.lat, best.lon)
          ? candidate
          : best,
      undefined,
    );
  }
  if (!place) throw new Error("Directory has no municipalities");

  if (!hasCity) {
    const municipality = directory.placeGeometries?.find(({ geometry }) =>
      inGeometry(longitude, latitude, geometry)
    );
    const coverage = directory.coverageGeometries?.find(({ geometry }) =>
      inGeometry(longitude, latitude, geometry)
    );
    const containing = directory.places.find((candidate) =>
      candidate.code === (municipality?.code ?? coverage?.cityPsgc)
    );
    if (
      !containing &&
      !(directory.regionGeometry &&
        inGeometry(longitude, latitude, directory.regionGeometry))
    ) {
      return {
        snapshotDate: directory.snapshotDate,
        status: "outside_region",
        locationLabel: "Outside Davao Region",
        localPrimaryCount: 0,
        localSecondaryCount: 0,
        facilities: [],
      };
    }
    place = containing ?? place;
  }

  const local = directory.facilities.filter((facility) =>
    facility.cityPsgc === place.code
  );
  return {
    snapshotDate: directory.snapshotDate,
    status: "ok",
    locationLabel: `${place.name}, ${place.province}`,
    localPrimaryCount:
      local.filter((facility) => facility.level === 2 || facility.level === 3)
        .length,
    localSecondaryCount:
      local.filter((facility) => facility.level === 1).length,
    facilities: directory.facilities
      .filter((facility) =>
        facility.level === 2 || facility.level === 3 ||
        (request.includeLevel1 && facility.level === 1)
      )
      .map((facility) => ({
        ...facility,
        distanceKm: km(latitude, longitude, facility.lat, facility.lon),
      }))
      .sort((a, b) =>
        a.distanceKm - b.distanceKm || a.name.localeCompare(b.name)
      )
      .slice(0, 10)
      .map((facility) => ({
        ...facility,
        distanceKm: Math.round(facility.distanceKm * 10) / 10,
      })),
  };
}
