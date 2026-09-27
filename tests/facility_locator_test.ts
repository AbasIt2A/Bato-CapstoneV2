import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import directoryJson from "../supabase/functions/facility-locator/directory.json" with {
  type: "json",
};
import {
  type Directory,
  searchDirectory,
} from "../supabase/functions/facility-locator/search.ts";

const directory: Directory = {
  snapshotDate: "2026-08-01",
  sourceUrl: "https://nhfr.doh.gov.ph/",
  regionGeometry: {
    type: "MultiPolygon",
    coordinates: [
      [[[125, 6], [126, 6], [126, 8], [125, 8], [125, 6]]],
      [[[126.1, 6], [126.2, 6], [126.2, 6.1], [126.1, 6.1], [126.1, 6]]],
    ],
  },
  places: [
    {
      code: "1",
      name: "Davao City",
      province: "Davao del Sur",
      lat: 7.07,
      lon: 125.61,
    },
    {
      code: "2",
      name: "Digos City",
      province: "Davao del Sur",
      lat: 6.75,
      lon: 125.36,
    },
    {
      code: "3",
      name: "Mati City",
      province: "Davao Oriental",
      lat: 7.1,
      lon: 125.9,
    },
  ],
  facilities: [
    {
      code: "P1",
      name: "Primary nearby",
      level: 2,
      address: "A",
      barangay: "A",
      barangayPsgc: "1",
      city: "Davao City",
      cityPsgc: "1",
      province: "Davao del Sur",
      lat: 7.08,
      lon: 125.62,
      phone: null,
      email: null,
      licenseValidUntil: null,
    },
    {
      code: "S1",
      name: "Secondary closer",
      level: 1,
      address: "B",
      barangay: "B",
      barangayPsgc: "2",
      city: "Davao City",
      cityPsgc: "1",
      province: "Davao del Sur",
      lat: 7.07,
      lon: 125.615,
      phone: "123",
      email: null,
      licenseValidUntil: null,
    },
    {
      code: "P2",
      name: "Primary adjacent",
      level: 3,
      address: "C",
      barangay: "C",
      barangayPsgc: "3",
      city: "Digos City",
      cityPsgc: "2",
      province: "Davao del Sur",
      lat: 6.75,
      lon: 125.36,
      phone: null,
      email: null,
      licenseValidUntil: null,
    },
    {
      code: "S2",
      name: "Secondary only",
      level: 1,
      address: "D",
      barangay: "D",
      barangayPsgc: "4",
      city: "Mati City",
      cityPsgc: "3",
      province: "Davao Oriental",
      lat: 7.1,
      lon: 125.9,
      phone: null,
      email: null,
      licenseValidUntil: null,
    },
  ],
};

Deno.test("primary labs rank nearest and Level 1 stays hidden until requested", () => {
  const primary = searchDirectory(directory, {
    cityCode: "1",
    includeLevel1: false,
  });
  assertEquals(primary.status, "ok");
  assertEquals(primary.locationLabel, "Davao City, Davao del Sur");
  assertEquals([primary.localPrimaryCount, primary.localSecondaryCount], [
    1,
    1,
  ]);
  assertEquals(primary.facilities.map((f) => f.code), ["P1", "P2"]);
  assertEquals(primary.facilities[0].distanceKm > 0, true);

  const expanded = searchDirectory(directory, {
    cityCode: "1",
    includeLevel1: true,
  });
  assertEquals(expanded.facilities.map((f) => f.code), [
    "S1",
    "P1",
    "S2",
    "P2",
  ]);
});

Deno.test("municipality with only Level 1 exposes counts and adjacent primary labs", () => {
  const result = searchDirectory(directory, {
    cityCode: "3",
    includeLevel1: false,
  });
  assertEquals([result.localPrimaryCount, result.localSecondaryCount], [0, 1]);
  assertEquals(result.facilities[0].code, "P1");
});

Deno.test("proximity order uses full distance before display rounding", () => {
  const closer = {
    ...directory.facilities[0],
    code: "NEAR",
    name: "Z nearer",
    lat: 7.07009,
    lon: 125.61,
  };
  const farther = {
    ...directory.facilities[0],
    code: "FAR",
    name: "A farther",
    lat: 7.07036,
    lon: 125.61,
  };
  const result = searchDirectory({
    ...directory,
    facilities: [farther, closer],
  }, {
    cityCode: "1",
    includeLevel1: false,
  });
  assertEquals(result.facilities.map((f) => f.code), ["NEAR", "FAR"]);
});

Deno.test("coordinates use region geometry, including separate islands and holes", () => {
  assertEquals(
    searchDirectory(directory, {
      latitude: 6.05,
      longitude: 126.15,
      includeLevel1: false,
    }).status,
    "ok",
  );
  assertEquals(
    searchDirectory(directory, {
      latitude: 14.6,
      longitude: 121,
      includeLevel1: false,
    }).status,
    "outside_region",
  );

  const withHole: Directory = {
    ...directory,
    regionGeometry: {
      type: "Polygon",
      coordinates: [
        [[125, 6], [126, 6], [126, 8], [125, 8], [125, 6]],
        [[125.4, 6.4], [125.6, 6.4], [125.6, 6.6], [125.4, 6.6], [125.4, 6.4]],
      ],
    },
  };
  assertEquals(
    searchDirectory(withHole, {
      latitude: 6.5,
      longitude: 125.5,
      includeLevel1: false,
    }).status,
    "outside_region",
  );
});

Deno.test("geolocation uses the containing municipality before its nearest center", () => {
  const withMunicipality: Directory = {
    ...directory,
    placeGeometries: [{
      code: "2",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [125.6, 7],
          [125.8, 7],
          [125.8, 7.2],
          [125.6, 7.2],
          [125.6, 7],
        ]],
      },
    }],
  };
  const result = searchDirectory(withMunicipality, {
    latitude: 7.07,
    longitude: 125.61,
    includeLevel1: false,
  });
  assertEquals(result.locationLabel, "Digos City, Davao del Sur");
  assertEquals([result.localPrimaryCount, result.localSecondaryCount], [1, 0]);
});

Deno.test("a containing municipality remains covered when the region polygon has a gap", () => {
  const withRegionGap: Directory = {
    ...directory,
    regionGeometry: {
      type: "Polygon",
      coordinates: [[
        [126, 6],
        [127, 6],
        [127, 8],
        [126, 8],
        [126, 6],
      ]],
    },
    placeGeometries: [{
      code: "2",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [125.6, 7],
          [125.8, 7],
          [125.8, 7.2],
          [125.6, 7.2],
          [125.6, 7],
        ]],
      },
    }],
  };
  const result = searchDirectory(withRegionGap, {
    latitude: 7.07,
    longitude: 125.61,
    includeLevel1: false,
  });
  assertEquals(result.status, "ok");
  assertEquals(result.locationLabel, "Digos City, Davao del Sur");
});

Deno.test("a source barangay coverage polygon resolves its municipality across map gaps", () => {
  const withCoverage: Directory = {
    ...directory,
    regionGeometry: {
      type: "Polygon",
      coordinates: [[
        [126, 6],
        [127, 6],
        [127, 8],
        [126, 8],
        [126, 6],
      ]],
    },
    placeGeometries: [],
    coverageGeometries: [{
      cityPsgc: "2",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [125.6, 7],
          [125.8, 7],
          [125.8, 7.2],
          [125.6, 7.2],
          [125.6, 7],
        ]],
      },
    }],
  };
  const result = searchDirectory(withCoverage, {
    latitude: 7.07,
    longitude: 125.61,
    includeLevel1: false,
  });
  assertEquals(result.status, "ok");
  assertEquals(result.locationLabel, "Digos City, Davao del Sur");
});

Deno.test("current Davao City facility points remain inside locator coverage", () => {
  const current = directoryJson as Directory;
  for (const code of ["DOH000000000041760", "DOH000000000041762"]) {
    const facility = current.facilities.find((item) => item.code === code);
    assertEquals(Boolean(facility), true);
    const result = searchDirectory(current, {
      latitude: facility!.lat,
      longitude: facility!.lon,
      includeLevel1: false,
    });
    assertEquals(result.status, "ok", code);
    assertEquals(result.locationLabel.startsWith("City of Davao"), true, code);
  }
});

Deno.test("invalid or ambiguous location inputs are rejected", () => {
  for (
    const input of [
      { cityCode: "unknown", includeLevel1: false },
      { latitude: 7, includeLevel1: false },
      { latitude: Infinity, longitude: 125, includeLevel1: false },
      { latitude: 7, longitude: 181, includeLevel1: false },
      { cityCode: "1", latitude: 7, longitude: 125, includeLevel1: false },
      { cityCode: "1", includeLevel1: "yes" },
    ]
  ) {
    assertThrows(() => searchDirectory(directory, input));
  }
});
