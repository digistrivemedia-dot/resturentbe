// node src/controllers/admin.analytics.test.js
//
// Guards the three admin-analytics metrics that were silently wrong. Each one
// looked plausible on screen, which is why none of them was noticed:
//
//   1. Avg Rating queried rating.foodRating — a field that does not exist in
//      the Order schema — so it always said "No ratings yet".
//   2. Dispatch Success matched only orders that already had a Flash taskId,
//      then counted failures within that set. A failed dispatch has no taskId,
//      so failures were filtered out before being counted: the rate was
//      structurally always 100%. Live data reported 100% against a true 36%.
//   3. Avg Delivery Time subtracted createdAt, measuring the whole order
//      lifecycle (checkout + prep + idle) rather than the delivery leg. Live
//      data averaged 1867 minutes and displayed it as "Avg Delivery Time".
//
// Plus the input hardening: an unparseable or absent date range must not
// produce `createdAt: {}`, which Mongoose rejects with "Cast to date failed" —
// that 500 blanked the entire page, since every section is gated on the KPIs.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const { dateRangeMatch, parseDate, buildPlatformOrderMatch } = require("../utils/analyticsFilters");

// ── 1. the rating field must actually exist on the schema ──────────────────
const ratingPaths = Object.keys(Order.schema.paths).filter((p) => p.startsWith("rating"));
assert.ok(
  !ratingPaths.includes("rating.foodRating"),
  "schema gained rating.foodRating — if this is now real, the KPI can read it directly"
);
assert.ok(
  Order.schema.path("rating.itemRatings"),
  "rating.itemRatings is where dish ratings live; the Avg Rating KPI depends on it"
);

const controller = fs.readFileSync(path.join(__dirname, "admin.analytics.controller.js"), "utf8");
assert.ok(
  !/rating\.foodRating/.test(controller),
  "controller still references rating.foodRating — a field that does not exist, so the KPI reads zero forever"
);
assert.ok(
  /rating\.itemRatings\.0/.test(controller) && /\$avg: "\$rating\.itemRatings\.rating"/.test(controller),
  "Avg Rating must aggregate rating.itemRatings"
);

// ── 2. dispatch success must count ATTEMPTS, not just successes ────────────
assert.ok(
  /dispatchFailedReason": \{ \$exists: true, \$nin: \[null, ""\] \}/.test(controller),
  "delivery health must include failed dispatches (dispatchFailedReason) in the denominator"
);
assert.ok(
  !/\$match: \{ \.\.\.match, "deliveryTracking\.flash\.taskId": \{ \$exists: true \} \}/.test(controller),
  "matching only taskId-present orders makes the success rate structurally 100%"
);

// ── 3. delivery time must measure the delivery leg ────────────────────────
assert.ok(
  /deliveryTracking\.flash\.dispatchedAt", "\$deliveryTracking\.pickedUpAt/.test(controller),
  "avg delivery time must start from dispatch/pickup"
);
assert.ok(
  !/\$subtract: \["\$deliveryTracking\.deliveredAt", "\$createdAt"\]/.test(controller),
  "subtracting createdAt measures the whole order lifecycle, not the delivery"
);

// ── 4. date-range hardening ───────────────────────────────────────────────
assert.strictEqual(dateRangeMatch(undefined, undefined), null, "no bounds must omit the key, never yield {}");
assert.strictEqual(dateRangeMatch("banana", "apple"), null, "unparseable bounds must omit the key, not cast-error");
assert.strictEqual(parseDate("banana"), null);
assert.ok(dateRangeMatch("2026-01-01", undefined).$gte instanceof Date, "a single valid bound still applies");
assert.ok(dateRangeMatch(undefined, "2026-01-01").$lte instanceof Date);

// The thing that actually 500'd: createdAt present but empty.
for (const f of [{}, { startDate: "banana" }, { startDate: "banana", endDate: "apple" }]) {
  const m = buildPlatformOrderMatch(f, null);
  assert.ok(
    !("createdAt" in m) || Object.keys(m.createdAt).length > 0,
    `buildPlatformOrderMatch(${JSON.stringify(f)}) produced an empty createdAt — Mongoose will throw "Cast to date failed"`
  );
}

// A malformed id must be dropped, not thrown on.
const m = buildPlatformOrderMatch({}, ["not-an-objectid", "6a44ba8f7fc8a94ac5150b40"]);
assert.strictEqual(m.restaurant.$in.length, 1, "invalid ids must be filtered out, leaving the valid one");
assert.ok(m.restaurant.$in[0] instanceof mongoose.Types.ObjectId);

// ── 5. the page must not blank when one panel fails ──────────────────────
const storeDir = path.join(__dirname, "../../../frontend/src/stores");
for (const f of ["adminAnalyticsStore.js", "adminRestaurantAnalyticsStore.js"]) {
  const p = path.join(storeDir, f);
  if (!fs.existsSync(p)) continue; // backend may be deployed without the frontend checkout
  const src = fs.readFileSync(p, "utf8");
  assert.ok(
    /Promise\.allSettled/.test(src),
    `${f} uses Promise.all — one failing endpoint rejects the batch and blanks every section`
  );
  assert.ok(
    !/\bthrow err;/.test(src),
    `${f} rethrows into a caller that never catches, producing an unhandled rejection`
  );
}

console.log("ok — rating reads a real field, dispatch counts attempts, delivery time measures the leg, bad input can't 500");
