// node src/controllers/coupon.secret.test.js
//
// Two things that must hold:
//   1. free_delivery is a declared coupon type (the enum the validator and the
//      Mongoose schema both read), otherwise creating one 400s.
//   2. getAvailableCoupons hides isSecret coupons but leaves pre-existing
//      coupons (field absent) visible — hence $ne: true, not false.
const assert = require("assert");
const { COUPON_TYPE } = require("../utils/constants");
const Coupon = require("../models/Coupon");

// 1 — type is declared
assert.ok(
  Object.values(COUPON_TYPE).includes("free_delivery"),
  "free_delivery missing from COUPON_TYPE — restaurant/admin coupon create will 400"
);
assert.ok(
  Coupon.schema.path("type").enumValues.includes("free_delivery"),
  "free_delivery missing from the Coupon schema enum"
);

// 2 — the filter semantics. A plain { isSecret: false } would drop every
// coupon created before the field existed, so assert $ne: true behaviour
// against the three possible stored states.
const matches = (filterValue, stored) => {
  if (filterValue.$ne !== undefined) return stored !== filterValue.$ne;
  return stored === filterValue;
};
const FILTER = { $ne: true };
assert.strictEqual(matches(FILTER, undefined), true, "old coupon (no field) must stay visible");
assert.strictEqual(matches(FILTER, false), true, "public coupon must be visible");
assert.strictEqual(matches(FILTER, true), false, "secret coupon must be hidden");

assert.strictEqual(Coupon.schema.path("isSecret").defaultValue, false);

// 3 — every query that SHOWS coupons to a customer must carry the filter;
// every query that REDEEMS one by code must not (or a secret code would stop
// working, which is the opposite of the point). Checked at source level
// because these are inline queries, not extracted functions.
const fs = require("fs");
const path = require("path");
const src = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

const HIDES = ["coupon.controller.js", "home.controller.js"];
for (const f of HIDES) {
  assert.ok(
    /isSecret:\s*\{\s*\$ne:\s*true\s*\}/.test(src(f)),
    `${f} lists coupons to customers but is missing the isSecret filter — secret codes would leak`
  );
}

// validateCoupon lives in coupon.controller.js alongside the listing, so
// assert on the redemption lookups instead: they key off `code` only.
assert.ok(
  /findOne\(\{\s*\n?\s*code:/.test(src("coupon.controller.js")),
  "validateCoupon must still look up by code alone, so secret coupons stay redeemable"
);
assert.ok(
  !/isSecret/.test(src("order.controller.js")),
  "order.controller.js must not filter on isSecret — it would block redemption at checkout"
);

console.log("ok — free_delivery declared; secret coupons hidden from list + home feed, still redeemable by code");
