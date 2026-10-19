// node src/controllers/pos.test.js
//
// The dine-in POS has three things that silently cause real damage if they
// break, and none of them are visible from the UI until it's too late:
//   1. Bill money — wrong tax or a discount that goes negative is a refund.
//   2. Table status — derived, not stored; a wrong branch means a waiter
//      walks past a table whose food is sitting under the lamp.
//   3. The "ready" alert must reach ONE waiter. Broadcast it and every
//      waiter walks to the pass for someone else's order.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const srcAt = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ── 1. Bill money ──────────────────────────────────────────────────────────
const { computeBillTotals } = require("../services/billing.service");

// Several rounds on one table add up, then GST on the lot.
let b = computeBillTotals(
  [{ pricing: { subtotal: 100 } }, { pricing: { subtotal: 250 } }, { pricing: { subtotal: 50 } }],
  5,
  0
);
assert.strictEqual(b.subtotal, 400, "bill subtotal must sum every order on the table");
assert.strictEqual(b.taxAmount, 20, "5% GST on 400 should be 20");
assert.strictEqual(b.total, 420, "total should be subtotal + tax");

// Discount applies BEFORE tax — taxing money the guest never paid is wrong.
b = computeBillTotals([{ pricing: { subtotal: 1000 } }], 5, 100);
assert.strictEqual(b.taxAmount, 45, "GST must be charged on the discounted amount (900), not 1000");
assert.strictEqual(b.total, 945);

// A discount bigger than the tab must clamp, never produce a negative bill.
b = computeBillTotals([{ pricing: { subtotal: 300 } }], 5, 500);
assert.strictEqual(b.discount, 300, "discount must clamp to the subtotal");
assert.strictEqual(b.total, 0, "a bill can never go negative");
assert.ok(b.total >= 0);

// A negative discount would be a surcharge smuggled in through the discount field.
b = computeBillTotals([{ pricing: { subtotal: 300 } }], 5, -100);
assert.strictEqual(b.discount, 0, "negative discounts must be floored at 0");
assert.strictEqual(b.total, 315);

// Restaurants on a different GST slab must be honoured, not hardcoded to 5.
b = computeBillTotals([{ pricing: { subtotal: 200 } }], 18, 0);
assert.strictEqual(b.taxAmount, 36, "must use the restaurant's own gstPercentage");

// Float noise must not reach a printed bill (0.1+0.2 territory).
b = computeBillTotals([{ pricing: { subtotal: 33.33 } }, { pricing: { subtotal: 66.67 } }], 5, 0);
assert.strictEqual(b.total, 105, "money must be rounded to 2dp, not carry float drift");

// ── 2. Table status derivation ─────────────────────────────────────────────
const { deriveTableStatus } = require("./pos.controller");

assert.strictEqual(deriveTableStatus([]), "free", "no unbilled orders = free table");
assert.strictEqual(
  deriveTableStatus([{ status: "confirmed" }]),
  "preparing",
  "an accepted order the kitchen hasn't started is still 'preparing' to the floor"
);
assert.strictEqual(deriveTableStatus([{ status: "preparing" }]), "preparing");
assert.strictEqual(
  deriveTableStatus([{ status: "delivered" }, { status: "ready" }]),
  "ready",
  "ready must win over served — that's the one needing a waiter RIGHT NOW"
);
assert.strictEqual(
  deriveTableStatus([{ status: "preparing" }, { status: "ready" }]),
  "ready",
  "ready must outrank preparing too"
);
assert.strictEqual(
  deriveTableStatus([{ status: "delivered" }, { status: "delivered" }]),
  "served",
  "all served but unbilled = open tab, NOT free (losing this loses the money)"
);

// ── 3. The targeted waiter alert ───────────────────────────────────────────
const kitchen = src("kitchen.controller.js");

assert.ok(
  /io\.to\(`user:\$\{waiterId\}`\)\.emit\("order_ready_for_pickup"/.test(kitchen),
  "the ready alert must be emitted to the single waiter's room, not the floor"
);
assert.ok(
  !/io\.to\(`restaurant:\$\{[^}]+\}`\)\.emit\("order_ready_for_pickup"/.test(kitchen),
  "order_ready_for_pickup must NEVER go to the restaurant-wide room"
);
assert.ok(
  /order\.placedBy\?\._id \|\| order\.placedBy/.test(kitchen),
  "waiterId must handle placedBy being populated or a raw ObjectId — a populated doc as a room name reaches nobody"
);
assert.ok(
  /Notification\.create\(/.test(kitchen),
  "the alert must also persist, or a waiter whose tablet slept never learns the food is up"
);

// The socket must actually join the room the alert is sent to.
const socket = srcAt("socket/index.js");
assert.ok(
  /socket\.join\(`user:\$\{socket\.userId\}`\)/.test(socket),
  "sockets must join user:<id> or the targeted alert lands nowhere"
);
assert.ok(
  /\{ staff: userId \}/.test(socket),
  "staff must resolve a restaurant on socket connect, or the kitchen display gets no live tickets"
);

// ── 4. Payment integrity ───────────────────────────────────────────────────
const pos = src("pos.controller.js");

assert.ok(
  /const MANUAL_METHODS = \["cash", "card", "upi", "other"\]/.test(pos),
  "markBillPaid must not accept 'qr' — only Razorpay's webhook may settle a self-confirming QR bill"
);
assert.ok(
  /paymentMethod === "upi" && bill\.razorpayQr\?\.provider === "razorpay"/.test(pos),
  "'upi' must not be usable to hand-close a bill showing a self-confirming Razorpay QR"
);

// ── 4b. The UPI fallback QR ────────────────────────────────────────────────
const { createUpiQr } = require("../services/billing.service");

(async () => {
  const { imageUrl, upiUrl } = await createUpiQr("cafe@okhdfcbank", "Sri Isha Cafe", 441, "Bill B1 Table 7");

  assert.ok(upiUrl.startsWith("upi://pay?"), "must be a UPI intent link");
  assert.ok(/[?&]pa=cafe%40okhdfcbank/.test(upiUrl), "payee VPA must be URL-encoded into pa");
  assert.ok(/[?&]am=441\.00/.test(upiUrl), "amount must be a plain 2dp decimal — UPI apps reject odd formats");
  assert.ok(/[?&]cu=INR/.test(upiUrl), "currency must be set");
  assert.ok(imageUrl.startsWith("data:image/png;base64,"), "QR must be a self-contained data URI so the bill prints offline");

  // Float drift must never reach the amount a guest is asked to pay.
  const { upiUrl: drifted } = await createUpiQr("a@b", "X", 0.1 + 0.2, "n");
  assert.ok(/[?&]am=0\.30/.test(drifted), `0.1+0.2 must render as 0.30, got: ${drifted}`);

  const billing = fs.readFileSync(path.join(__dirname, "..", "services/billing.service.js"), "utf8");
  assert.ok(
    /if \(viaRazorpay\.qrId\) return \{ \.\.\.viaRazorpay, provider: "razorpay" \}/.test(billing),
    "Razorpay QR must be preferred over the manual-confirm fallback when available"
  );
  assert.ok(
    /provider: "upi"/.test(billing),
    "the fallback must label itself so the UI knows it does NOT self-confirm"
  );

  const billPage = fs.readFileSync(
    path.join(__dirname, "../../../frontend/src/app/(pos)/pos/bill/[id]/page.js"), "utf8"
  );
  assert.ok(
    /if \(bill\.razorpayQr\?\.provider !== "razorpay"\) return;/.test(billPage),
    "the bill page must not poll for a payment confirmation that can never arrive"
  );

  console.log("ok — UPI fallback QR (intent link, 2dp amount, data URI, razorpay preferred, no phantom polling)");
})().catch((e) => { console.error("UPI QR check failed:", e.message); process.exit(1); });
const webhook = src("webhook.controller.js");
assert.ok(
  /event === "qr_code\.credited"/.test(webhook),
  "QR bills are only settled by the qr_code.credited webhook — without it they never close"
);
assert.ok(
  /bill\.paymentStatus === "paid"\) return/.test(webhook),
  "the QR webhook must be idempotent — Razorpay retries, and double-settling corrupts the till"
);
assert.ok(
  /closeBillQr\(bill\.razorpayQr\?\.qrId\)/.test(pos),
  "paying by cash must close the QR, or the guest can still scan and pay twice"
);

// ── 5. Concurrency claims ──────────────────────────────────────────────────
assert.ok(
  /\{ _id: \{ \$in: bill\.orders \}, bill: null \}/.test(pos),
  "billing must claim orders filtered on bill:null, or two waiters can bill the same food twice"
);
assert.ok(
  /claim\.modifiedCount !== orders\.length/.test(pos),
  "a partial claim must roll the bill back rather than bill a subset"
);
assert.ok(
  /\{ _id: order\._id, status: order\.status \}/.test(kitchen),
  "the kitchen must claim its transition, or two cooks both fire the waiter's alert"
);

// ── 6. Walk-in orders ──────────────────────────────────────────────────────
const orderModel = srcAt("models/Order.js");
assert.ok(
  !/customer: \{\s*type: mongoose\.Schema\.Types\.ObjectId,\s*ref: "User",\s*required: true/.test(orderModel),
  "Order.customer must be optional — a dine-in walk-in has no account"
);
const restOrder = src("restaurant.order.controller.js");
assert.strictEqual(
  (restOrder.match(/if \(order\.customer\) \{/g) || []).length,
  2,
  "both notification sites must guard on order.customer or they crash on a dine-in order"
);

// Customer analytics must not count walk-ins as one giant phantom customer.
for (const f of ["restaurant.analytics.controller.js", "admin.analytics.controller.js", "restaurant.customer.controller.js"]) {
  assert.ok(
    /customer: \{ \$ne: null \}/.test(src(f)),
    `${f} must exclude null customers from per-customer aggregations`
  );
}

console.log(
  "ok — bill math (tax/discount/clamp/rounding), table status, single-waiter alert, QR-only settlement, concurrency claims, walk-in orders"
);
