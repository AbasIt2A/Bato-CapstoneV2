import { useEffect, useRef, useState, type FormEvent } from "react";
import { getPlaces, searchFacilities, type LocatorResults, type Place, type SearchLocation, type FacilityResult } from "./api";
import { approximateDeviceLocation } from "./device-location";
import { getResultNotice } from "./result-notice";
import LocatorMap from "./LocatorMap";
import "./locator.css";

const TOGGLE_LABEL = "Also show laboratories where creatinine testing is not a required service";

function directionsUrl(facility: FacilityResult): string {
  const query = [facility.name, facility.address, facility.barangay, facility.city, facility.province, "Philippines"]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export default function FacilityLocator() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [snapshotDate, setSnapshotDate] = useState("");
  const [placesError, setPlacesError] = useState("");
  const [includeLevel1, setIncludeLevel1] = useState(false);
  const [results, setResults] = useState<LocatorResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentSearch = useRef<SearchLocation | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    getPlaces()
      .then((data) => {
        if (!active) return;
        setSnapshotDate(data.snapshotDate);
        setPlaces(data.places.sort((a, b) => a.province.localeCompare(b.province) || a.name.localeCompare(b.name)));
      })
      .catch((cause: unknown) => {
        if (active) setPlacesError(cause instanceof Error ? cause.message : "Could not load cities and municipalities.");
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, []);

  async function runSearch(location: SearchLocation, showLevel1: boolean) {
    const id = ++requestId.current;
    currentSearch.current = location;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const data = await searchFacilities(location, showLevel1);
      if (id !== requestId.current) return;
      setResults(data);
      setSnapshotDate(data.snapshotDate);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : "Could not search the facility directory.");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  function submitPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCode) void runSearch({ cityCode: selectedCode }, includeLevel1);
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      setError("This browser cannot provide a location. Choose a city or municipality instead.");
      return;
    }
    const id = ++requestId.current;
    currentSearch.current = null;
    setBusy(true);
    setError("");
    setResults(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (id !== requestId.current) return;
        const location = approximateDeviceLocation(coords);
        if (!location) {
          setBusy(false);
          setError("Your browser location is too imprecise to identify your city. Choose a city or municipality manually, or try a more accurate device.");
          return;
        }
        void runSearch(location, includeLevel1);
      },
      () => {
        if (id !== requestId.current) return;
        setBusy(false);
        setError("Location was unavailable or permission was declined. Choose a city or municipality instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const notice = results ? getResultNotice(results, includeLevel1) : null;

  return (
    <div className="locator-page">
      <header className="locator-intro">
        <span className="locator-eyebrow">Laboratory directory</span>
        <h1>Find a clinical laboratory</h1>
        <p>Explore nearby laboratories in Davao Region for a serum creatinine blood test. Level 2 and Level 3 laboratories are shown by default because routine clinical chemistry is required at those service levels.</p>
      </header>

      <section className="card locator-controls" aria-label="Choose a search location">
        <div className="locator-section-heading">
          <div>
            <h2>Choose a location</h2>
            <p>Search by city or municipality, or use your device location.</p>
          </div>
        </div>
        <form onSubmit={submitPlace}>
          <label htmlFor="locator-place">City or municipality in Davao Region</label>
          <div className="locator-control-row">
            <select id="locator-place" value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)} disabled={places.length === 0 || busy} required>
              <option value="">Choose a city or municipality</option>
              {places.map((place) => <option key={place.code} value={place.code}>{place.name}, {place.province}</option>)}
            </select>
            <button className="button-link accent" type="submit" disabled={!selectedCode || busy}>Find laboratories</button>
          </div>
        </form>
        <div className="locator-alternative">
          <span className="locator-or">Or</span>
          <button className="button-link locator-location-button" type="button" onClick={useDeviceLocation} disabled={busy}>Use my approximate location</button>
          <p className="hint">Your browser asks permission only when you choose this option. Location is used for this search and is not saved by BATO.</p>
        </div>
        {placesError && <p className="error-text" role="alert">City list unavailable: {placesError}</p>}
        <div className="locator-filter">
          <label className="locator-toggle">
            <input type="checkbox" checked={includeLevel1} disabled={busy} onChange={(event) => {
              const checked = event.target.checked;
              setIncludeLevel1(checked);
              if (currentSearch.current) void runSearch(currentSearch.current, checked);
            }} />
            <span>{TOGGLE_LABEL}</span>
          </label>
          <p className="hint">Level 1 laboratories may not provide routine clinical chemistry. Contact them before visiting.</p>
        </div>
      </section>

      <section className="locator-results" aria-live="polite" aria-busy={busy}>
        {busy && <p>Finding nearby laboratories…</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {results && <>
          <div className="locator-results-heading">
            <div>
              <span className="locator-eyebrow">Search results</span>
              <h2>Laboratories near {results.locationLabel}</h2>
            </div>
            <span className="locator-count">{results.facilities.length} {results.facilities.length === 1 ? "laboratory" : "laboratories"}</span>
          </div>
          {currentSearch.current && "latitude" in currentSearch.current && (
            <p className="hint">If your browser placed you in the wrong city, choose your city or municipality above.</p>
          )}
          {notice && <p className="locator-notice">{notice}</p>}
          {results.facilities.length > 0 && <>
            <div className="locator-map-panel">
              <div className="locator-map-heading">
                <h3>Area overview</h3>
                <p className="hint">Map pins show representative barangay locations, not exact laboratory premises. Check the address before travelling.</p>
              </div>
              <LocatorMap facilities={results.facilities} />
            </div>
            <ol className="facility-list">
              {results.facilities.map((facility) => <li className="card facility-item" key={facility.code}>
                <div className="facility-heading">
                  <div>
                    <span className="facility-level">Level {facility.level} clinical laboratory</span>
                    <h3>{facility.name}</h3>
                  </div>
                  <span className="facility-distance">{Number.isFinite(facility.distanceKm) ? `${facility.distanceKm.toFixed(1)} km away` : "Distance unavailable"}</span>
                </div>
                <p className="facility-address">{[facility.address, facility.barangay, facility.city, facility.province].filter(Boolean).join(", ")}</p>
                {facility.level === 1 && <p className="locator-notice">Routine clinical chemistry is not a required service at Level 1. Contact this laboratory to confirm serum creatinine testing before visiting.</p>}
                {facility.phone || facility.email ? <p>Contact: {facility.phone && <span>{facility.phone}</span>}{facility.phone && facility.email && " · "}{facility.email && <a href={`mailto:${facility.email}`}>{facility.email}</a>}</p> : <p>No phone number or email is listed; confirm availability before visiting.</p>}
                <p className="hint">{facility.licenseValidUntil ? `Registry licence validity date: ${facility.licenseValidUntil}.` : "Licence validity date not published in this snapshot."}</p>
                <a className="facility-directions" href={directionsUrl(facility)} target="_blank" rel="noopener noreferrer">Check location and directions <span aria-hidden="true">↗</span></a>
              </li>)}
            </ol>
          </>}
        </>}
      </section>

      <aside className="card locator-disclaimer">
        <h2>Before you visit</h2>
        <p>BATO screening is not a diagnosis; discuss testing and results with a health professional.</p>
        <p>This directory is informational, not an endorsement or clinical referral. It uses a DOH National Health Facility Registry snapshot{snapshotDate ? ` imported ${snapshotDate}` : ""}; licence status may have changed. Service capability suggests possible testing, but each laboratory&apos;s current serum creatinine service has not been individually verified. Confirm test availability, operating hours, address, and current licence directly with the facility before travelling.</p>
        <p>Distances are approximate straight-line distances from your chosen location to representative barangay points, not travel distances or exact premises.</p>
      </aside>
    </div>
  );
}
