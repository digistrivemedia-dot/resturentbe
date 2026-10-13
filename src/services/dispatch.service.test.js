// node src/services/dispatch.service.test.js
//
// Covers the Petpooja↔Flash handoff. The failure mode being guarded against
// is operational, not a crash: an order that reaches the POS but never gets a
// rider, or gets two.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Stub Flash + Mongo so dispatchFlashRider can run without either ────────
const calls = [];
let flashResponse = { status: true, TaskId: "TASK1", Status_code: "ALLOTTED" };
let storedTaskId = null;

const realResolve = Module._resolveFilename;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "./flash.service") {
    return {
      createTask: async (order) => {
        calls.push(order.orderNumber);
        if (flashResponse instanceof Error) throw flashResponse;
        return flashResponse;
      },
    };
  }
  if (request === "../models/Order") {
    return {
      findById: () => ({
        select: () => ({
          lean: async () => ({ deliveryTracking: { flash: { taskId: storedTaskId } } }),
        }),
      }),
    };
  }
  return realLoad.apply(this, arguments);
};

const { dispatchFlashRider } = require("./dispatch.service");

const RESTAURANT = {
  name: "SIC E.City",
  contact: { phone: "9999999999" },
  address: { fullAddress: "Electronic City, Bengaluru" },
};
const newOrder = (over = {}) => ({
  _id: "o1",
  orderNumber: "ORD-1",
  orderType: "delivery",
  paymentStatus: "paid",
  customer: { phone: "8888888888" },
  deliveryAddress: { lat: 12.9, lng: 77.6 },
  deliveryTracking: {},
  ...over,
});

(async () => {
  // 1 — happy path: paid delivery order gets a Flash task.
  calls.length = 0; storedTaskId = null;
  let o = newOrder();
  let r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
  assert.strictEqual(r.outcome, "dispatched");
  assert.strictEqual(o.deliveryTracking.flash.taskId, "TASK1");
  assert.strictEqual(calls.length, 1);

  // 2 — THE important one. Two riders for one order has already happened in
  // production from a double-click; the dashboard and the Petpooja callback
  // are two separate code paths, so the status-level claim can't protect
  // against them racing. Only the taskId guard can.
  calls.length = 0; storedTaskId = "TASK1";
  o = newOrder({ deliveryTracking: {} }); // in-memory copy has no taskId yet
  r = await dispatchFlashRider(o, RESTAURANT, { source: "dashboard" });
  assert.strictEqual(r.outcome, "already", "a second trigger must not dispatch a second rider");
  assert.strictEqual(calls.length, 0, "Flash must not be called when a task already exists");

  // 3 — COD is delivered by the restaurant's own riders. This is a normal
  // outcome, not a failure: recording it as a failure made every COD order
  // look broken and would now fire a false 'no rider' alert.
  calls.length = 0; storedTaskId = null;
  o = newOrder({ paymentStatus: "pending" });
  r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
  assert.strictEqual(r.outcome, "manual_delivery");
  assert.strictEqual(calls.length, 0, "Flash rejects COD — don't call it");
  assert.strictEqual(o.deliveryTracking.flash.dispatchFailedReason, undefined,
    "COD must not be recorded as a dispatch failure");

  // 4 — pickup/dine-in need no rider at all.
  for (const t of ["pickup", "dine_in"]) {
    o = newOrder({ orderType: t });
    r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
    assert.strictEqual(r.outcome, "not_delivery", `${t} must not dispatch a rider`);
  }

  // 5 — missing data Flash hard-rejects is caught BEFORE calling it, and
  // reports a reason the alert can repeat to a human.
  calls.length = 0; storedTaskId = null;
  o = newOrder({ deliveryAddress: {} }); // no lat/lng
  r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
  assert.strictEqual(r.outcome, "blocked");
  assert.match(r.reason, /map location/);
  assert.strictEqual(calls.length, 0, "don't call Flash with a payload it will reject");

  // 6 — Flash refusing is surfaced, not swallowed.
  storedTaskId = null;
  flashResponse = { status: false, msg: { pickup: "out of range" } };
  o = newOrder();
  r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
  assert.strictEqual(r.outcome, "failed");
  assert.match(r.reason, /out of range/);

  // 7 — a thrown error is an outcome, never an unhandled rejection inside a
  // webhook that must still return 200.
  flashResponse = new Error("ETIMEDOUT");
  o = newOrder();
  r = await dispatchFlashRider(o, RESTAURANT, { source: "petpooja" });
  assert.strictEqual(r.outcome, "failed");
  assert.strictEqual(r.reason, "ETIMEDOUT");

  Module._load = realLoad;

  // ── Wiring assertions: the logic above is useless if nothing calls it ────
  const src = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  const webhook = src("controllers/webhook.controller.js");
  assert.ok(
    /dispatchFlashRider\(order, restaurant, \{ source: "petpooja" \}\)/.test(webhook),
    "the Petpooja callback must dispatch a rider — otherwise no rider ever comes once staff stop using our dashboard"
  );
  // Status 4 is Petpooja's "Dispatch". Staff who tap it without "Food Ready"
  // would otherwise leave the order out_for_delivery with no rider at all.
  assert.ok(
    /String\(status\) === "5" \|\| String\(status\) === "4"/.test(webhook),
    "dispatch must fire on Petpooja status 4 (Dispatch) as well as 5 (Food Ready)"
  );
  assert.ok(
    /updateRiderStatus\(order, restaurant, status_code\)/.test(webhook),
    "Flash's webhook must mirror rider info onto the POS"
  );

  const dashboard = src("controllers/restaurant.order.controller.js");
  assert.ok(
    /dispatchFlashRider\(order, req\.restaurant, \{ source: "dashboard" \}\)/.test(dashboard),
    "the dashboard path must use the shared dispatcher, not its own copy of the guards"
  );
  assert.ok(
    !/createTask\(/.test(dashboard),
    "the dashboard must no longer call createTask directly — one dispatcher, or the two drift"
  );

  const orders = src("controllers/order.controller.js");
  assert.ok(
    /notifyRestaurantUrgent/.test(orders),
    "a rejected POS push must alert a human: the customer is waiting and nobody is cooking"
  );
  // Only an explicit rejection raises the alarm. A missing POS order id is
  // logged as unconfirmed — alerting on it would cry wolf on every order if
  // Petpooja simply doesn't echo an id, and orders ARE confirmed arriving.
  assert.ok(
    /String\(result\?\.success\) === "1"/.test(orders) && /no POS order id returned/.test(orders),
    "a blank POS order id must be logged as unconfirmed, not reported as a failure"
  );

  // The callback must populate the customer's phone. createTask sends it as
  // Flash's drop_details.contact_number and dispatchFlashRider checks it, so
  // populating only "name" blocks every rider request on the Petpooja path.
  assert.ok(
    /populate\("customer", "name phone email"\)/.test(webhook),
    "the Petpooja callback must populate customer.phone or dispatch is blocked for every order"
  );

  const petpooja = src("services/petpooja.service.js");
  for (const v of ["rider-assigned", "rider-arrived", "pickedup", "delivered"]) {
    assert.ok(petpooja.includes(v), `rider status "${v}" must be mapped (Petpooja 400s on any other value)`);
  }
  assert.ok(
    /external_order_id: ""/.test(petpooja),
    "external_order_id must be sent blank, per Petpooja's blueprint"
  );

  // Update Order Status field names are counter-intuitive and easy to get
  // wrong: our order number is clientorderID, orderID must be blank, and the
  // reason is camelCase on this one endpoint. Getting any of them wrong makes
  // the cancellation silently fail to match an order.
  assert.ok(/clientorderID: order\.orderNumber/.test(petpooja),
    "cancel must send our order number as clientorderID");
  assert.ok(/orderID: ""/.test(petpooja),
    "cancel must send orderID blank — it is Petpooja's own id, deprecated");
  assert.ok(/cancelReason:/.test(petpooja) && !/cancel_reason:/.test(petpooja),
    "cancel must use cancelReason (camelCase), not cancel_reason");

  console.log("ok — dispatch fires once from either trigger, COD stays manual, POS push failures alert, rider mirrors to POS");
})().catch((e) => {
  Module._load = realLoad;
  console.error("FAIL —", e.message);
  process.exit(1);
});
