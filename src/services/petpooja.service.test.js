// node src/services/petpooja.service.test.js
// Guards the Save Order envelope shape — the exact thing that made Petpooja
// return success:1 with a blank orderID for a week.
const assert = require("assert");
const { buildSaveOrderPayload } = require("./petpooja.service");

const order = {
  orderNumber: "TESTORDER2011",
  orderType: "delivery",
  paymentMethod: "cod",
  createdAt: "2026-09-29T20:00:00",
  items: [{ menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1 }],
  pricing: { subtotal: 80, discount: 0, taxAmount: 4, taxPercentage: 5, deliveryFee: 0, packagingCharge: 0 },
  deliveryAddress: { fullAddress: "Bengaluru", lat: 12.97, lng: 77.59 },
};
const restaurant = {
  name: "Sri Isha Cafe",
  address: { fullAddress: "Gunjur" },
  contact: { phone: "8897755850" },
  posIntegration: { petpooja: { restID: "t4pqh7yeaj", accessToken: "tok" } },
};
const menuItemsById = { m1: { petpooja: { itemId: "24384" } } };

const p = buildSaveOrderPayload(order, restaurant, { name: "Rohan", phone: "1", email: "a@b.c" }, "https://x/cb", menuItemsById);
const info = p.orderinfo.OrderInfo;

// The bug: these two must be {details:[...]}, never bare arrays.
assert(!Array.isArray(info.OrderItem) && Array.isArray(info.OrderItem.details), "OrderItem must be {details:[]}");
assert(!Array.isArray(info.Tax) && Array.isArray(info.Tax.details), "Tax must be {details:[]}");
assert(!("Discount" in info), "Discount key was removed from the schema");
assert.strictEqual(p.orderinfo.device_type, "Web");

assert.strictEqual(info.OrderItem.details[0].id, "24384");
assert.strictEqual(info.OrderItem.details[0].final_price, "80");

// Tax.details ids must match the ids the items reference, and sum them.
const itemTaxIds = info.OrderItem.details[0].item_tax.map((t) => t.id).sort();
assert.deepStrictEqual(info.Tax.details.map((t) => t.id).sort(), itemTaxIds);
assert.strictEqual(
  info.Tax.details.reduce((s, t) => s + Number(t.tax), 0),
  4,
  "Tax.details must sum to tax_total"
);
assert.strictEqual(info.Tax.details[0].price, "2.5", "price is a bare percentage, no % sign");

console.log("ok");
