const axios = require("axios");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");

const APP_KEY = process.env.PETPOOJA_APP_KEY;
const APP_SECRET = process.env.PETPOOJA_APP_SECRET;
const SAVE_ORDER_URL = process.env.PETPOOJA_SAVE_ORDER_URL;
const UPDATE_STATUS_URL = process.env.PETPOOJA_UPDATE_STATUS_URL;

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// "YYYY-MM-DD H:i:s" — the exact format Petpooja's docs ask for (created_on,
// preorder_date/time are derived from the same value).
function formatDateTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { datePart, timePart, combined: `${datePart} ${timePart}` };
}

// restaurantMiddleware's req.restaurant never has accessToken populated
// (select: false on the schema), so most callers only have restID handy.
// Re-fetch with the token explicitly selected whenever it's missing.
async function resolvePetpoojaCredentials(restaurant) {
  const petpooja = restaurant.posIntegration?.petpooja;
  if (petpooja?.accessToken) return petpooja;

  const fresh = await Restaurant.findById(restaurant._id).select(
    "+posIntegration.petpooja.accessToken"
  );
  return fresh?.posIntegration?.petpooja;
}

const ORDER_TYPE_MAP = {
  delivery: "H",
  pickup: "P",
  dine_in: "D",
  self_service: "D",
};

// Splits a rupee tax amount into CGST/SGST halves — the standard Indian GST
// convention, and what to fall back to whenever we don't have Petpooja's own
// per-item tax rates on hand (see MenuItem.petpooja.taxes).
function splitIntoCgstSgst(taxAmount, taxPercentage) {
  const halfPercentage = round2((taxPercentage || 0) / 2);
  const halfAmount = round2((taxAmount || 0) / 2);
  return [
    { id: "1", name: "CGST", taxPercentage: halfPercentage, amount: halfAmount },
    { id: "2", name: "SGST", taxPercentage: halfPercentage, amount: halfAmount },
  ];
}

// Per-item tax lines for OrderItem.details[].item_tax. Uses the item's own
// Petpooja tax mapping if it's been filled in (see MenuItem.petpooja.taxes);
// otherwise falls back to splitting the order's flat tax percentage across
// this item's share of the subtotal.
function buildItemTaxLines(orderItem, menuItem, order) {
  const lineTotal = orderItem.price * orderItem.quantity;

  if (menuItem?.petpooja?.taxes?.length) {
    return menuItem.petpooja.taxes.map((t, idx) => ({
      id: t.id || String(idx + 1),
      name: t.name,
      tax_percentage: String(t.taxPercentage),
      amount: String(round2(lineTotal * (t.taxPercentage / 100))),
    }));
  }

  const lineTaxTotal = round2(lineTotal * ((order.pricing.taxPercentage || 0) / 100));
  return splitIntoCgstSgst(lineTaxTotal, order.pricing.taxPercentage).map((t) => ({
    id: t.id,
    name: t.name,
    tax_percentage: String(t.taxPercentage),
    amount: String(t.amount),
  }));
}

// Matches an order line's flat variant/addon names (snapshotted at order
// time on Order.items) back to the MenuItem doc's variant/addon subdocs, to
// pull out the petpooja ids attached there via manual mapping.
function buildOrderItemPayload(orderItem, menuItem, order) {
  let variationId = "";
  let variationName = "";
  if (orderItem.variant?.name && menuItem?.variants?.length) {
    const matched = menuItem.variants.find((v) => v.name === orderItem.variant.name);
    if (matched) {
      variationId = matched.petpoojaVariationId || "";
      variationName = matched.name;
    }
  }

  const addonItems = (orderItem.addons || []).map((addon) => {
    let petpoojaAddonItemId = "";
    for (const group of menuItem?.addonGroups || []) {
      const matched = group.addons?.find((a) => a.name === addon.name);
      if (matched) {
        petpoojaAddonItemId = matched.petpoojaAddonItemId || "";
        break;
      }
    }
    return {
      id: petpoojaAddonItemId,
      name: addon.name,
      price: String(addon.price),
      quantity: "1",
    };
  });

  return {
    id: menuItem?.petpooja?.itemId || "",
    name: orderItem.name,
    // The PDF's own field table says "price = item unit price + addons",
    // but its own JSON example shows price=250 with a separate addon at 50
    // NOT summed in — those two parts of the same document contradict each
    // other. Following the concrete example over the prose here (addons are
    // already broken out separately below); no item-level discount exists
    // in this app's data model, so final_price = price, matching the example.
    price: String(orderItem.price),
    final_price: String(orderItem.price),
    quantity: String(orderItem.quantity),
    gst_liability: "restaurant",
    item_tax: buildItemTaxLines(orderItem, menuItem, order),
    tax_inclusive: false,
    item_discount: "",
    description: orderItem.specialInstructions || "",
    variation_name: variationName,
    variation_id: variationId,
    AddonItem: { details: addonItems },
  };
}

// Tax.details must be the per-item item_tax lines rolled up by tax id — the
// ids have to match what the items reference, otherwise Petpooja can't tie
// the two together. restaurant_liable_amt == tax because every line we send
// is gst_liability:"restaurant" (this platform never collects GST itself).
function aggregateTaxDetails(orderItems) {
  const byId = new Map();
  for (const item of orderItems) {
    for (const line of item.item_tax) {
      const existing = byId.get(line.id);
      const amount = round2((existing ? Number(existing.tax) : 0) + Number(line.amount));
      byId.set(line.id, {
        id: line.id,
        title: line.name,
        type: "P",
        price: String(line.tax_percentage),
        tax: String(amount),
        restaurant_liable_amt: String(amount),
      });
    }
  }
  return [...byId.values()];
}

// Builds the Save Order payload.
//
// ENVELOPE SHAPE — confirmed by Petpooja support (2026-10-01), after days of
// save_order returning {"success":"1", orderID:""} with nothing ever showing
// in Order Listing. OrderItem and Tax are NOT bare arrays: they are objects
// wrapping a "details" array, exactly like Restaurant/Customer/Order. Sending
// bare arrays passes their API gateway (hence success:1) but the POS-side
// parser reads OrderItem.details, gets undefined, and silently drops the
// order — blank orderID is the only symptom. There is no "Discount" key;
// order-level discount goes in Order.details.discount_total/discount_type.
// "udid" and "device_type" sit on orderinfo, as siblings of OrderInfo.
function buildSaveOrderPayload(order, restaurant, customer, callbackUrl, menuItemsById) {
  const petpooja = restaurant.posIntegration.petpooja;
  const { datePart, timePart, combined } = formatDateTime(order.scheduledFor || order.createdAt);

  const orderItems = order.items.map((item) =>
    buildOrderItemPayload(item, menuItemsById[String(item.menuItem)], order)
  );

  const taxDetails = aggregateTaxDetails(orderItems);

  // Petpooja's "Total" should only be the amount due to the restaurant —
  // deliveryFee (paid to Flash), platformFee and tip (ours/the rider's) are
  // deliberately excluded, unlike order.pricing.total which is customer-facing.
  const restaurantDueTotal = round2(
    order.pricing.subtotal -
      order.pricing.discount +
      order.pricing.taxAmount +
      (order.pricing.packagingCharge || 0)
  );
  const pcTaxAmount = round2((order.pricing.packagingCharge || 0) * ((order.pricing.taxPercentage || 0) / 100));

  return {
    app_key: APP_KEY,
    app_secret: APP_SECRET,
    access_token: petpooja.accessToken,
    orderinfo: {
      OrderInfo: {
        Restaurant: {
          details: {
            res_name: restaurant.name,
            address: restaurant.address?.fullAddress || "",
            contact_information: restaurant.contact?.phone || "",
            restID: petpooja.restID,
          },
        },
        Customer: {
          details: {
            email: customer.email || "",
            name: customer.name,
            address: order.deliveryAddress?.fullAddress || restaurant.address?.fullAddress || "",
            phone: customer.phone || "",
            latitude: order.deliveryAddress?.lat != null ? String(order.deliveryAddress.lat) : "",
            longitude: order.deliveryAddress?.lng != null ? String(order.deliveryAddress.lng) : "",
          },
        },
        Order: {
          details: {
            orderID: order.orderNumber,
            preorder_date: datePart,
            preorder_time: timePart,
            service_charge: "0",
            sc_tax_amount: "0",
            delivery_charges: String(order.pricing.deliveryFee || 0),
            dc_tax_percentage: "0",
            dc_tax_amount: "0",
            packing_charges: String(order.pricing.packagingCharge || 0),
            pc_tax_percentage: String(order.pricing.taxPercentage || 0),
            pc_tax_amount: String(pcTaxAmount),
            // Packing charge is the restaurant's, so its GST is theirs too.
            pc_gst_details: [
              { gst_liable: "vendor", amount: "0" },
              { gst_liable: "restaurant", amount: String(pcTaxAmount) },
            ],
            order_type: ORDER_TYPE_MAP[order.orderType] || "H",
            advanced_order: order.scheduledFor ? "Y" : "N",
            urgent_order: false,
            payment_type: order.paymentMethod === "cod" ? "COD" : "ONLINE",
            table_no: "",
            no_of_persons: "0",
            discount_total: String(round2(order.pricing.discount)),
            discount_type: "F",
            tax_total: String(order.pricing.taxAmount),
            total: String(restaurantDueTotal),
            description: order.items.map((i) => i.specialInstructions).filter(Boolean).join("; "),
            created_on: combined,
            // 0 = third-party rider — this platform dispatches Flash, never its own riders.
            enable_delivery: order.orderType === "delivery" ? 0 : 1,
            callback_url: callbackUrl,
          },
        },
        OrderItem: { details: orderItems },
        Tax: { details: taxDetails },
      },
      udid: "",
      device_type: "Web",
    },
  };
}

// POST Save Order — pushes a placed order into the restaurant's Petpooja POS.
async function saveOrder(order, restaurant, customer, callbackUrl) {
  if (!SAVE_ORDER_URL) {
    throw new Error("PETPOOJA_SAVE_ORDER_URL is not configured");
  }

  const petpoojaCreds = await resolvePetpoojaCredentials(restaurant);
  if (!petpoojaCreds?.restID || !petpoojaCreds?.accessToken) {
    throw new Error("Restaurant is not linked to Petpooja (missing restID/accessToken)");
  }
  restaurant.posIntegration.petpooja = petpoojaCreds;

  const menuItemIds = order.items.map((i) => i.menuItem).filter(Boolean);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } }).lean();
  const menuItemsById = {};
  menuItems.forEach((m) => { menuItemsById[String(m._id)] = m; });

  const missingMapping = order.items.filter(
    (i) => !menuItemsById[String(i.menuItem)]?.petpooja?.itemId
  );
  if (missingMapping.length > 0) {
    const names = missingMapping.map((i) => i.name).join(", ");
    throw new Error(`Not pushed — missing Petpooja item mapping for: ${names}`);
  }

  const payload = buildSaveOrderPayload(order, restaurant, customer, callbackUrl, menuItemsById);
  const res = await axios.post(SAVE_ORDER_URL, payload, { timeout: 15000 });
  return res.data;
}

// POST Update Order Status with status: "-1" — the only write-back Petpooja's
// API documents (cancel only; there's no way to push accepted/preparing/ready).
async function cancelOrder(restaurant, order, cancelReason) {
  if (!UPDATE_STATUS_URL) {
    throw new Error("PETPOOJA_UPDATE_STATUS_URL is not configured — get it from the sandbox's API Documentation tab");
  }

  const petpoojaCreds = await resolvePetpoojaCredentials(restaurant);
  if (!petpoojaCreds?.restID || !petpoojaCreds?.accessToken) {
    throw new Error("Restaurant is not linked to Petpooja (missing restID/accessToken)");
  }

  const res = await axios.post(
    UPDATE_STATUS_URL,
    {
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      access_token: petpoojaCreds.accessToken,
      restID: petpoojaCreds.restID,
      orderID: order.orderNumber,
      status: "-1",
      cancel_reason: cancelReason || "",
    },
    { timeout: 10000 }
  );
  return res.data;
}

module.exports = {
  saveOrder,
  cancelOrder,
  resolvePetpoojaCredentials,
  buildSaveOrderPayload, // exported for the manual test-order verification step
};
