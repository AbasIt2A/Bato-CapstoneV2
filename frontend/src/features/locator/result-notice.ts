export interface LocatorNoticeResult {
  status: "ok" | "outside_region";
  localPrimaryCount: number;
  localSecondaryCount: number;
  facilities: readonly unknown[];
}

export function getResultNotice(result: LocatorNoticeResult, includeLevel1: boolean): string | null {
  if (result.status === "outside_region") {
    return "Directory coverage is currently limited to Davao Region. Choose a city or municipality there to explore listed laboratories.";
  }
  if (result.facilities.length === 0) {
    return "No matching laboratories were found in this directory snapshot. Please contact a local health center for testing options.";
  }
  if (!includeLevel1 && result.localPrimaryCount === 0 && result.localSecondaryCount > 0) {
    return 'No Level 2 or Level 3 laboratory is listed in this municipality. Select “Also show laboratories where creatinine testing is not a required service” to see local Level 1 options.';
  }
  if (result.localPrimaryCount === 0 && result.localSecondaryCount === 0) {
    return "No listed laboratories are in this municipality. Showing the nearest options in nearby municipalities.";
  }
  return null;
}
