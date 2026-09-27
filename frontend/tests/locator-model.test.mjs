import assert from "node:assert/strict";
import test from "node:test";
import { getResultNotice } from "../src/features/locator/result-notice.ts";

test("locator explains coverage and local laboratory gaps", () => {
  const result = {
    status: "ok",
    locationLabel: "Digos City",
    localPrimaryCount: 0,
    localSecondaryCount: 1,
    facilities: [{ code: "nearby" }],
  };

  assert.match(getResultNotice({ ...result, status: "outside_region" }, false), /limited to Davao Region/);
  assert.match(getResultNotice(result, false), /Also show laboratories/);
  assert.match(getResultNotice({ ...result, localSecondaryCount: 0 }, false), /nearby municipalities/);
  assert.match(getResultNotice({ ...result, facilities: [] }, true), /No matching laboratories/);
});
