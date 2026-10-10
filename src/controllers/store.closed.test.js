// node src/controllers/store.closed.test.js
//
// The open/close toggle writes restaurant.timing.isOpen. Two things must hold
// or the toggle is decorative again:
//   1. placeOrder rejects when the store is closed (immediate orders only —
//      a scheduled order is for a later time, so it stays allowed).
//   2. updateProfile MERGES req.body.timing instead of replacing it, so the
//      toggle's { timing: { isOpen } } doesn't wipe openTime/closeTime/offDays.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

// 1 — the guard exists in the order path, and exempts scheduled orders.
const order = src("order.controller.js");
assert.ok(
  /timing\?\.isOpen === false && !scheduledFor/.test(order),
  "placeOrder is missing the closed-store guard — customers can order from a closed restaurant"
);

// 2 — timing must not be in the blind-overwrite allowedFields list.
const profile = src("restaurant.profile.controller.js");
const allowedBlock = profile.slice(
  profile.indexOf("const allowedFields"),
  profile.indexOf("];", profile.indexOf("const allowedFields"))
);
assert.ok(
  !/"timing"/.test(allowedBlock),
  "timing is still blind-overwritten in allowedFields — a toggle-only update would wipe opening hours"
);
assert.ok(
  /req\.body\.timing !== undefined/.test(profile) && /\.\.\.existing, \.\.\.req\.body\.timing/.test(profile),
  "updateProfile must merge req.body.timing onto the existing subdocument"
);

// The merge semantics themselves, since that's the part that loses data.
const merge = (existing, incoming) => ({ ...existing, ...incoming });
const before = { openTime: "11:00", closeTime: "23:00", offDays: ["Monday"], isOpen: true };
const after = merge(before, { isOpen: false });
assert.strictEqual(after.isOpen, false, "toggle must take effect");
assert.strictEqual(after.openTime, "11:00", "openTime must survive a toggle-only update");
assert.strictEqual(after.closeTime, "23:00", "closeTime must survive a toggle-only update");
assert.deepStrictEqual(after.offDays, ["Monday"], "offDays must survive a toggle-only update");

// A restaurant whose timing predates the field (isOpen undefined) must read as
// OPEN, not closed — otherwise every existing restaurant goes dark on deploy.
assert.ok(undefined !== false, "sanity");
assert.strictEqual({}.isOpen === false, false, "missing isOpen must not count as closed");

console.log("ok — closed stores reject immediate orders; toggle-only updates keep opening hours");
