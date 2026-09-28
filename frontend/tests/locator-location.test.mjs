import assert from "node:assert/strict";
import test from "node:test";
import { approximateDeviceLocation } from "../src/features/locator/device-location.ts";

test("keeps Davao City coordinates precise enough for municipality lookup", () => {
  assert.deepEqual(
    approximateDeviceLocation({ latitude: 7.0944, longitude: 125.6444, accuracy: 50 }),
    { latitude: 7.094, longitude: 125.644 },
  );
  assert.equal(
    approximateDeviceLocation({ latitude: 7.0944, longitude: 125.6444, accuracy: 5000 }),
    null,
  );
});
