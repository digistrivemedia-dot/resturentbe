// node src/services/petpooja.service.test.js
// Guards the Save Order payload: the envelope shape (which made Petpooja
// return success:1 with a blank orderID for a week), and the arithmetic that
// has to reconcile — item_tax vs tax_total vs total.
const assert = require("assert");
const { buildSaveOrderPayload, indexMenuCache } = require("./petpooja.service");

// Shaped like the real cached Menu Push for restID t4pqh7yeaj.
const cache = indexMenuCache({
  taxes: [
    { taxid: "3881", taxname: "CGST", tax: "2.5" },
    { taxid: "3882", taxname: "SGST", tax: "2.5" },
  ],
  items: [
    { itemid: "24384", itemname: "Plain Dahi", item_tax: "3881,3882", tax_inclusive: false },
    { itemid: "24295", itemname: "Palak Corn", item_tax: "3881,3882", tax_inclusive: true },
  ],
  addongroups: [
    {
      addongroupid: "17140",
      addongroup_name: "Customization",
      addongroupitems: [
        { addonitemid: "92077", addonitem_name: "Coke", addonitem_price: "40" },
      ],
    },
  ],
});

const restaurant = {
  name: "Sri Isha Cafe",
  address: { fullAddress: "Gunjur" },
  contact: { phone: "8897755850" },
  posIntegration: { petpooja: { restID: "t4pqh7yeaj", accessToken: "tok" } },
};
const customer = { name: "Rohan", phone: "1", email: "a@b.c" };

const build = (items, pricing, menuItemsById) =>
  buildSaveOrderPayload(
    {
      orderNumber: "T1", orderType: "delivery", paymentMethod: "cod",
      createdAt: "2026-10-01T20:00:00", items, pricing,
      deliveryAddress: { fullAddress: "Bengaluru", lat: 12.97, lng: 77.59 },
    },
    restaurant, customer, "https://x/cb", menuItemsById, cache
  );

const plainPricing = { subtotal: 80, discount: 0, taxAmount: 4, taxPercentage: 5, deliveryFee: 0, packagingCharge: 0 };

// --- envelope -------------------------------------------------------------
let p = build(
  [{ menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1 }],
  plainPricing,
  { m1: { petpooja: { itemId: "24384" } } }
);
let info = p.orderinfo.OrderInfo;
assert(!Array.isArray(info.OrderItem) && Array.isArray(info.OrderItem.details), "OrderItem must be {details:[]}");
assert(!Array.isArray(info.Tax) && Array.isArray(info.Tax.details), "Tax must be {details:[]}");
assert(!("Discount" in info), "Discount key was removed from the schema");
assert.strictEqual(p.orderinfo.device_type, "Web");

// --- real tax ids come from the cache, not the "1"/"2" fallback -----------
assert.deepStrictEqual(info.Tax.details.map((t) => t.id).sort(), ["3881", "3882"]);
assert.strictEqual(info.Tax.details[0].price, "2.5", "bare percentage, no % sign");
assert.strictEqual(info.Order.details.tax_total, "4");
assert.strictEqual(info.Order.details.total, "84", "80 + 4 tax");

// --- addons: group_id is an INT, counted in total, not folded into price --
p = build(
  [{ menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1,
     addons: [{ groupName: "Customization", name: "Coke", price: 40 }] }],
  plainPricing,
  { m1: { petpooja: { itemId: "24384" }, addonGroups: [{ name: "Customization", addons: [{ name: "Coke", petpoojaAddonItemId: "92077" }] }] } }
);
info = p.orderinfo.OrderInfo;
const addon = info.OrderItem.details[0].AddonItem.details[0];
assert.strictEqual(addon.id, "92077");
assert.strictEqual(addon.group_id, 17140, "group_id must be a number");
assert.strictEqual(typeof addon.group_id, "number");
assert.strictEqual(addon.group_name, "Customization");
assert.strictEqual(info.OrderItem.details[0].price, "80", "addons stay out of item price");
assert.strictEqual(info.Order.details.total, "124", "80 item + 40 addon + 4 tax");

// --- tax_inclusive is read from the catalogue, not hardcoded --------------
p = build(
  [{ menuItem: "m2", name: "Palak Corn", price: 240, quantity: 1 }],
  { subtotal: 240, discount: 0, taxAmount: 12, taxPercentage: 5, deliveryFee: 0, packagingCharge: 0 },
  { m2: { petpooja: { itemId: "24295" } } }
);
assert.strictEqual(p.orderinfo.OrderInfo.OrderItem.details[0].tax_inclusive, true);

// --- discount is pushed down to items and taxed post-discount -------------
p = build(
  [{ menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1 }],
  { subtotal: 80, discount: 10, taxAmount: 3.5, taxPercentage: 5, deliveryFee: 0, packagingCharge: 0 },
  { m1: { petpooja: { itemId: "24384" } } }
);
info = p.orderinfo.OrderInfo;
let line = info.OrderItem.details[0];
assert.strictEqual(line.item_discount, "10");
assert.strictEqual(line.final_price, "70", "final_price = price - item_discount");
assert.strictEqual(line.item_tax[0].amount, "1.75", "tax on the DISCOUNTED amount");
assert.strictEqual(info.Order.details.tax_total, "3.5");
assert.strictEqual(info.Order.details.total, "73.5", "70 + 3.5 tax");

// --- multi-line discount apportioning sums back exactly -------------------
p = build(
  [
    { menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1 },
    { menuItem: "m2", name: "Palak Corn", price: 240, quantity: 2 },
  ],
  { subtotal: 560, discount: 33.33, taxAmount: 0, taxPercentage: 5, deliveryFee: 0, packagingCharge: 0 },
  { m1: { petpooja: { itemId: "24384" } }, m2: { petpooja: { itemId: "24295" } } }
);
info = p.orderinfo.OrderInfo;
// item_discount is per-unit and rounds to paise, so a qty-2 line can't always
// absorb an odd remainder. What must hold is that the header agrees with its
// own lines, and stays within a paisa per line of the real discount.
const applied = info.OrderItem.details.reduce(
  (s, i) => s + Number(i.item_discount || 0) * Number(i.quantity), 0
);
assert.strictEqual(
  Number(info.Order.details.discount_total),
  Math.round(applied * 100) / 100,
  "discount_total must equal the sum of item-level discounts"
);
assert(
  Math.abs(Number(info.Order.details.discount_total) - 33.33) <= 0.01 * info.OrderItem.details.length,
  "apportioned discount must stay within rounding distance of the order discount"
);

// tax_total must always equal the sum of its own Tax.details
const summed = info.Tax.details.reduce((s, t) => s + Number(t.tax), 0);
assert.strictEqual(Number(info.Order.details.tax_total), Math.round(summed * 100) / 100);

// --- no cache: still builds, falls back without throwing ------------------
p = buildSaveOrderPayload(
  { orderNumber: "T2", orderType: "delivery", paymentMethod: "cod", createdAt: "2026-10-01T20:00:00",
    items: [{ menuItem: "m1", name: "Plain Dahi", price: 80, quantity: 1 }], pricing: plainPricing,
    deliveryAddress: {} },
  restaurant, customer, "https://x/cb", { m1: { petpooja: { itemId: "24384" } } }, null
);
assert.deepStrictEqual(p.orderinfo.OrderInfo.Tax.details.map((t) => t.id), ["1", "2"]);

console.log("ok");
