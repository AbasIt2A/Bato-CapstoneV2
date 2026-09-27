import { useEffect, useRef } from "react";
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import type { FacilityResult } from "./api";

const markerIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function LocatorMap({ facilities }: { facilities: FacilityResult[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || facilities.length === 0) return;
    const map = L.map(container.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    const points: L.LatLngExpression[] = [];
    const grouped = new Map<string, FacilityResult[]>();
    for (const facility of facilities) {
      if (!Number.isFinite(facility.lat) || !Number.isFinite(facility.lon)) continue;
      const key = `${facility.lat},${facility.lon}`;
      grouped.set(key, [...(grouped.get(key) ?? []), facility]);
    }
    for (const group of grouped.values()) {
      const first = group[0];
      const point: L.LatLngExpression = [first.lat, first.lon];
      points.push(point);
      const popup = document.createElement("div");
      const names = document.createElement("ul");
      for (const facility of group) {
        const item = document.createElement("li");
        item.textContent = facility.name;
        names.append(item);
      }
      popup.append(names);
      const label = `${group.length} ${group.length === 1 ? "laboratory" : "laboratories"} in ${first.barangay}, ${first.city}`;
      L.marker(point, { icon: markerIcon, alt: label, title: label })
        .bindPopup(popup)
        .addTo(map);
    }
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 12 });
    return () => { map.remove(); };
  }, [facilities]);

  return <div ref={container} className="locator-map" aria-label="Map of nearby laboratories; the list below contains the same facilities" />;
}
