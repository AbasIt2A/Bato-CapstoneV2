import { ensureSession, getSupabaseClient } from "../../lib/supabase-client";

export interface Place {
  code: string;
  name: string;
  province: string;
}

export interface FacilityResult {
  code: string;
  name: string;
  level: number;
  address: string;
  barangay: string;
  city: string;
  province: string;
  lat: number;
  lon: number;
  phone: string | null;
  email: string | null;
  licenseValidUntil: string | null;
  distanceKm: number;
}

export interface LocatorResults {
  snapshotDate: string;
  status: "ok" | "outside_region";
  locationLabel: string;
  localPrimaryCount: number;
  localSecondaryCount: number;
  facilities: FacilityResult[];
}

export type SearchLocation = { cityCode: string } | { latitude: number; longitude: number };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await getSupabaseClient().functions.invoke("facility-locator", { body });
  if (error) {
    let detail = error.message;
    try {
      const context = (error as { context?: Response }).context;
      const response: unknown = context ? await context.json() : null;
      if (response && typeof response === "object" && "error" in response) {
        detail = String((response as { error: unknown }).error);
      }
    } catch {
      // Keep the request error if the response body cannot be read.
    }
    throw new Error(detail);
  }
  return data as T;
}

export function getPlaces(): Promise<{ snapshotDate: string; places: Place[] }> {
  return invoke({ action: "places" });
}

export function searchFacilities(location: SearchLocation, includeLevel1: boolean): Promise<LocatorResults> {
  return invoke({ action: "search", ...location, includeLevel1 });
}
