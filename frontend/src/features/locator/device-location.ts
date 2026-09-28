export function approximateDeviceLocation(coords: {
  latitude: number;
  longitude: number;
  accuracy: number;
}): { latitude: number; longitude: number } | null {
  // ponytail: 2 km is a practical cutoff; add map confirmation if browser accuracy proves unreliable.
  if (!Number.isFinite(coords.accuracy) || coords.accuracy > 2000) return null;
  // About 100 m precision reduces shifts across city boundaries.
  return {
    latitude: Math.round(coords.latitude * 1000) / 1000,
    longitude: Math.round(coords.longitude * 1000) / 1000,
  };
}
