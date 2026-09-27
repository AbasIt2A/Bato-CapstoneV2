import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const nhfrUrl = 'https://nhfr.doh.gov.ph/VActivefacilitiesList';
const boundariesBase = 'https://github.com/bendlikeabamboo/barangay-boundaries-repository/releases/download/v2026.4.13.0/';
const input = process.argv[2];
const snapshotDate = process.argv[3] ?? new Date().toISOString().slice(0, 10);
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error('Usage: node scripts/build-facility-directory.mjs <NHFR clinical laboratory CSV> [YYYY-MM-DD import date]');
}

function parseCsv(source) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (value || row.length) { row.push(value); rows.push(row); }
  const [header, ...values] = rows;
  return values.map(fields => Object.fromEntries(header.map((key, index) => [key, fields[index] ?? ''])));
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response.text();
}

function isoDate(value) {
  if (!value) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Unexpected license date: ${value}`);
  const [, month, day, year] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`Invalid license date: ${value}`);
  return iso;
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideGeometry(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) => insideRing(point, outer) && holes.every(hole => !insideRing(point, hole)));
}

function representativePoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const polygon of polygons) {
    const outer = polygon[0];
    const ys = outer.map(([, y]) => y);
    const min = Math.min(...ys), height = Math.max(...ys) - min;
    for (const fraction of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
      const y = min + height * fraction, crossings = [];
      for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
        const [xi, yi] = outer[i], [xj, yj] = outer[j];
        if ((yi <= y && yj > y) || (yj <= y && yi > y)) crossings.push(xi + (y - yi) * (xj - xi) / (yj - yi));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const width = crossings[i + 1] - crossings[i];
        const point = [(crossings[i] + crossings[i + 1]) / 2, y];
        if (width > (best?.width ?? 0) && insideRing(point, outer) && polygon.slice(1).every(hole => !insideRing(point, hole))) {
          best = { lon: point[0], lat: point[1], width };
        }
      }
    }
  }
  if (!best) throw new Error('Could not find an interior point for a boundary');
  const result = { lat: Number(best.lat.toFixed(6)), lon: Number(best.lon.toFixed(6)) };
  if (!insideGeometry([result.lon, result.lat], geometry)) throw new Error('Rounded representative point fell outside its boundary');
  return result;
}

const [licenseFile, ...geoJson] = await Promise.all([
  readFile(input),
  ...['barangays', 'municipalities', 'component_cities', 'highly_urbanized_cities', 'regions'].map(name => download(`${boundariesBase}${name}.geojson`)),
]);
const licenseCsv = licenseFile.toString('utf8');
const licenses = parseCsv(licenseCsv);
const barangays = new Map(JSON.parse(geoJson[0]).features
  .filter(feature => feature.properties.psgc_code?.startsWith('11'))
  .map(feature => [feature.properties.psgc_code, feature.geometry]));
const placeFeatures = geoJson.slice(1, 4).flatMap(text => JSON.parse(text).features)
  .filter(feature => feature.properties.psgc_code?.startsWith('11'))
  .sort((a, b) => a.properties.psgc_code.localeCompare(b.properties.psgc_code));
const placeGeometries = placeFeatures.map(feature => ({ code: feature.properties.psgc_code, geometry: feature.geometry }));

const eligible = licenses.filter(row =>
  row['Region PSGC'] === '1100000000' &&
  row['Health Facility Type'] === 'Clinical Laboratory' &&
  /<span[^>]*>\s*With License\s*<\/span>/i.test(row['Licensing Status']) &&
  /^Level [123]$/.test(row['Service Capability']) &&
  !/drug[ -]?test/i.test(row['Facility Name']) &&
  (!isoDate(row['License Validity Date']) || isoDate(row['License Validity Date']) >= snapshotDate)
);
const unmatched = eligible.filter(row => !barangays.has(row['Barangay PSGC']));
if (unmatched.length) throw new Error(`Missing 2023 barangay boundaries for ${unmatched.map(row => row['Health Facility Code']).join(', ')}`);
const facilities = eligible.map(row => {
  const { lat, lon } = representativePoint(barangays.get(row['Barangay PSGC']));
  return {
    code: row['Health Facility Code'],
    name: row['Facility Name'].replace(/&amp;/gi, '&'),
    level: Number(row['Service Capability'].slice(-1)),
    address: [row['Building name and #'], row['Street Name and #']].filter(Boolean).join(', '),
    barangay: row['Barangay Name'], barangayPsgc: row['Barangay PSGC'],
    city: row['City/Municipality Name'], cityPsgc: row['City/Municipality PSGC'],
    province: row['Province Name'], lat, lon,
    phone: row['Landline Number'] || row['Landline Number 2'] || null,
    email: row['Email Address'] || null,
    licensingStatus: 'With License',
    licenseValidUntil: isoDate(row['License Validity Date']),
  };
}).sort((a, b) => a.name.localeCompare(b.name));
const places = placeFeatures.map(feature => {
  const code = feature.properties.psgc_code;
  const local = facilities.filter(facility => facility.cityPsgc === code && insideGeometry([facility.lon, facility.lat], feature.geometry));
  let point;
  if (local.length) {
    const latitudes = local.map(facility => facility.lat).sort((a, b) => a - b);
    const longitudes = local.map(facility => facility.lon).sort((a, b) => a - b);
    const lat = latitudes[Math.floor(local.length / 2)], lon = longitudes[Math.floor(local.length / 2)];
    const closest = local.reduce((best, facility) => {
      const distance = (facility.lat - lat) ** 2 + (facility.lon - lon) ** 2;
      return !best || distance < best.distance ? { facility, distance } : best;
    }, null).facility;
    point = { lat: closest.lat, lon: closest.lon };
  } else point = representativePoint(feature.geometry);
  if (!insideGeometry([point.lon, point.lat], feature.geometry)) throw new Error(`Place point outside municipality ${code}`);
  const province = feature.properties.psgc_type === 'highly_urbanized_city'
    ? feature.properties.psgc_name
    : feature.properties.province ?? feature.properties.ADM2_EN;
  return { code, name: feature.properties.psgc_name, province, ...point };
});
const regionGeometry = JSON.parse(geoJson[4]).features.find(feature => feature.properties.psgc_code === '1100000000')?.geometry;
if (!regionGeometry || places.length !== 49 || !facilities.length) throw new Error('Directory source coverage check failed');
const cityGeometries = new Map(placeGeometries.map(item => [item.code, item.geometry]));
const coverageGeometries = [...new Map(facilities.filter(facility => {
  const cityGeometry = cityGeometries.get(facility.cityPsgc);
  if (!cityGeometry) throw new Error(`Missing city boundary ${facility.cityPsgc}`);
  const point = [facility.lon, facility.lat];
  return !insideGeometry(point, regionGeometry) || !insideGeometry(point, cityGeometry);
}).map(facility => [facility.barangayPsgc, {
  cityPsgc: facility.cityPsgc,
  barangayPsgc: facility.barangayPsgc,
  geometry: barangays.get(facility.barangayPsgc),
}])).values()];

const directory = {
  snapshotDate, sourceUrl: nhfrUrl,
  sourceSha256: createHash('sha256').update(licenseFile).digest('hex'),
  boundarySourceUrl: 'https://github.com/bendlikeabamboo/barangay-boundaries-repository/releases/tag/v2026.4.13.0',
  boundarySnapshotDate: '2023-10-24',
  placePointMethod: 'For municipalities with listed laboratories, use the laboratory barangay representative point nearest the median of local laboratory points; otherwise use an interior municipality boundary point.',
  facilities, places, placeGeometries, regionGeometry, coverageGeometries,
};
const output = new URL('../supabase/functions/facility-locator/directory.json', import.meta.url);
await mkdir(new URL('../supabase/functions/facility-locator/', import.meta.url), { recursive: true });
await writeFile(output, JSON.stringify(directory));
console.log(`Wrote ${facilities.length} facilities and ${places.length} places from 2023 boundaries; ${coverageGeometries.length} barangay coverage polygons bridge city/region boundary gaps.`);
console.log(`License CSV SHA-256: ${directory.sourceSha256}`);
