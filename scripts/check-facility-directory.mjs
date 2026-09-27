import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function contains(geometry, lon, lat) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const inRing = ring => ring.reduce((inside, [x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    return (y1 > lat) !== (y2 > lat) && lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1) ? !inside : inside;
  }, false);
  return rings.some(([outer, ...holes]) => inRing(outer) && holes.every(hole => !inRing(hole)));
}

const directory = JSON.parse(readFileSync(new URL('../supabase/functions/facility-locator/directory.json', import.meta.url)));
assert.match(directory.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(directory.sourceUrl, /^https:\/\/nhfr\.doh\.gov\.ph\//);
assert.match(directory.sourceSha256, /^[a-f0-9]{64}$/);
assert.equal(directory.boundarySnapshotDate, '2023-10-24');
assert.equal(directory.places.length, 49);
assert.equal(directory.placeGeometries.length, 49);
assert.ok(Array.isArray(directory.coverageGeometries));
assert.equal(directory.regionGeometry.type, 'MultiPolygon');
assert.ok(directory.facilities.length > 0);
assert.equal(new Set(directory.facilities.map(f => f.code)).size, directory.facilities.length);
assert.equal(new Set(directory.places.map(p => p.code)).size, directory.places.length);
for (const facility of directory.facilities) {
  assert.match(facility.code, /^DOH\d+$/);
  assert.ok([1, 2, 3].includes(facility.level));
  assert.equal(facility.licensingStatus, 'With License');
  assert.ok(!/drug[ -]?test/i.test(facility.name));
  assert.ok(!facility.licenseValidUntil || facility.licenseValidUntil >= directory.snapshotDate);
  assert.equal(typeof facility.lat, 'number');
  assert.equal(typeof facility.lon, 'number');
  assert.ok(facility.lat >= 5 && facility.lat <= 10);
  assert.ok(facility.lon >= 124 && facility.lon <= 127);
  const city = directory.placeGeometries.find(item => item.code === facility.cityPsgc)?.geometry;
  assert.ok(city, `Missing city for ${facility.code}`);
  const covered = contains(directory.regionGeometry, facility.lon, facility.lat) && contains(city, facility.lon, facility.lat);
  const fallback = directory.coverageGeometries.find(item => item.cityPsgc === facility.cityPsgc && item.barangayPsgc === facility.barangayPsgc);
  assert.ok(covered || (fallback && contains(fallback.geometry, facility.lon, facility.lat)), `No geographic coverage for ${facility.code}`);
}
for (const place of directory.places) {
  assert.match(place.code, /^11\d{8}$/);
  assert.notEqual(place.province, place.province.toUpperCase());
  assert.ok(place.lat >= 5 && place.lat <= 10);
  assert.ok(place.lon >= 124 && place.lon <= 127);
  const geometry = directory.placeGeometries.find(item => item.code === place.code)?.geometry;
  assert.ok(geometry, `Missing geometry for ${place.code}`);
  assert.ok(contains(geometry, place.lon, place.lat), `${place.name} point is outside its polygon`);
  const local = directory.facilities.filter(facility => facility.cityPsgc === place.code);
  if (local.length) {
    const lats = local.map(facility => facility.lat).sort((a, b) => a - b);
    const lons = local.map(facility => facility.lon).sort((a, b) => a - b);
    const medianLat = lats[Math.floor(local.length / 2)], medianLon = lons[Math.floor(local.length / 2)];
    const distance = facility => (facility.lat - medianLat) ** 2 + (facility.lon - medianLon) ** 2;
    assert.ok(local.some(facility => facility.lat === place.lat && facility.lon === place.lon));
    assert.equal((place.lat - medianLat) ** 2 + (place.lon - medianLon) ** 2, Math.min(...local.map(distance)));
  }
}
console.log(`Checked ${directory.facilities.length} facilities, ${directory.places.length} places, and ${directory.coverageGeometries.length} coverage polygons.`);
