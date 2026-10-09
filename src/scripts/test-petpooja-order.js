// node src/scripts/test-petpooja-order.js [restID]
//
// Relays ONE test order to Petpooja through the real petpooja.service code
// path — same payload builder, same menu cache, same item mapping, same HTTP
// call the app makes when a customer checks out.
//
// Writes nothing: no Order document, no payment, no Flash rider. It only
// POSTs to Petpooja, so the order shows up on their dashboard and nowhere
// else. Use it to prove the relay works without putting a fake order through
// production checkout.
require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const petpoojaService = require("../services/petpooja.service");

const restID = process.argv[2] || "wjdmg6hr1o";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  const restaurant = await Restaurant.findOne({ "posIntegration.petpooja.restID": restID });
  if (!restaurant) throw new Error(`No restaurant for restID ${restID}`);

  // Cheapest mapped item, so the dashboard total is easy to eyeball.
  const item = await MenuItem.findOne({
    restaurant: restaurant._id,
    "petpooja.itemId": { $exists: true, $nin: [null, ""] },
  }).sort({ price: 1 });
  if (!item) throw new Error("No mapped menu item — run map-petpooja-items.js --apply first");

  const taxPercentage = 5;
  const subtotal = item.price;
  const taxAmount = Math.round(subtotal * (taxPercentage / 100) * 100) / 100;

  // Shaped exactly like a real Order document, but never saved.
  const order = {
    orderNumber: `APPTEST${Date.now().toString().slice(-6)}`,
    orderType: "delivery",
    paymentMethod: "cod",
    createdAt: new Date(),
    items: [
      {
        menuItem: item._id,
        name: item.name,
        price: item.price,
        quantity: 1,
        itemTotal: item.price,
      },
    ],
    pricing: {
      subtotal,
      discount: 0,
      taxAmount,
      taxPercentage,
      deliveryFee: 0,
      packagingCharge: 0,
      total: subtotal + taxAmount,
    },
    deliveryAddress: {
      fullAddress: "DigistriveMedia 2nd floor, Bengaluru, Karnataka",
      lat: 12.9716,
      lng: 77.5946,
    },
  };

  const customer = { name: "App Relay Test", phone: "6289038527", email: "test@example.com" };
  const callbackUrl = `${process.env.BASE_URL}/api/v1/webhooks/petpooja/order-callback`;

  console.log(`\nRelaying ${order.orderNumber} — ${item.name} x1 @ Rs.${item.price} (petpooja id ${item.petpooja.itemId})`);
  console.log(`callback_url: ${callbackUrl}`);
  if (!/^https:\/\//.test(callbackUrl)) {
    console.warn("WARNING: callback_url is not https — Petpooja will not be able to reach it.");
  }

  try {
    const result = await petpoojaService.saveOrder(order, restaurant, customer, callbackUrl);
    console.log("\nPETPOOJA RESPONSE:", JSON.stringify(result, null, 2));
    if (String(result?.success) === "1") {
      console.log(`\nOK — look for ${order.orderNumber} in Order Listing for restID ${restID}.`);
    } else {
      console.log("\nPetpooja did not report success. Payload reached them but was rejected.");
    }
  } catch (err) {
    console.error("\nFAILED:", err.message);
    if (err.response?.data) console.error("response:", JSON.stringify(err.response.data, null, 2));
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
