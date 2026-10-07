const axios = require("axios");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const PetpoojaMenuCache = require("../models/PetpoojaMenuCache");

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

// Flattens a cached Menu Push payload into the lookups the payload builder
// needs. Petpooja's own catalogue is the only place the real ids live
// (tax ids like 3881/3882, addon group ids, tax_inclusive per item), so
// reading them here beats hand-mapping all 166 items onto MenuItem.petpooja
// and then watching them drift on the next menu change.
function indexMenuCache(raw) {
  const items = new Map();
  const taxes = new Map();
  const addonItems = new Map();

  for (const t of raw?.taxes || []) {
    taxes.set(String(t.taxid), { name: t.taxname, percentage: Number(t.tax) });
  }
  for (const i of raw?.items || []) items.set(String(i.itemid), i);
  for (const g of raw?.addongroups || []) {
    for (const a of g.addongroupitems || []) {
      addonItems.set(String(a.addonitemid), {
        name: a.addonitem_name,
        price: a.addonitem_price,
        groupId: Number(g.addongroupid),
        groupName: g.addongroup_name,
      });
    }
  }
  return { items, taxes, addonItems };
}

// Per-item tax lines for OrderItem.details[].item_tax.
//
// `base` is the DISCOUNTED line total — Petpooja computes item tax after the
// item discount (their own example: a 140 item less 14 discount taxes 126 at
// 2.5% = 3.15), and the amount covers the full ordered quantity.
//
// Tax ids come from the cached catalogue (item_tax is a CSV like "3881,3882"
// resolved against the taxes master). Those ids must match what Tax.details
// carries, so the "1"/"2" CGST/SGST split is a last resort only — it is
// better than crashing, but Petpooja cannot reconcile it against their own
// tax master, so treat a payload built from it as suspect.
function buildItemTaxLines(base, cacheItem, menuItem, order, cache) {
  const csv = cacheItem?.item_tax;
  if (csv && cache?.taxes?.size) {
    const lines = String(csv)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id, tax: cache.taxes.get(id) }))
      .filter((t) => t.tax)
      .map((t) => ({
        id: t.id,
        name: t.tax.name,
        tax_percentage: String(t.tax.percentage),
        amount: String(round2(base * (t.tax.percentage / 100))),
      }));
    if (lines.length) return lines;
  }

  if (menuItem?.petpooja?.taxes?.length) {
    return menuItem.petpooja.taxes.map((t, idx) => ({
      id: t.id || String(idx + 1),
      name: t.name,
      tax_percentage: String(t.taxPercentage),
      amount: String(round2(base * (t.taxPercentage / 100))),
    }));
  }

  const lineTaxTotal = round2(base * ((order.pricing.taxPercentage || 0) / 100));
  return splitIntoCgstSgst(lineTaxTotal, order.pricing.taxPercentage).map((t) => ({
    id: t.id,
    name: t.name,
    tax_percentage: String(t.taxPercentage),
    amount: String(t.amount),
  }));
}

// Matches an order line's flat variant/addon names (snapshotted at order
// time on Order.items) back to the MenuItem doc's variant/addon subdocs for
// the petpooja ids, then enriches from the cached catalogue where it can.
//
// `unitDiscount` is this line's share of the order-level discount, spread
// pro-rata across lines: this app has no per-item discount, but Petpooja
// taxes each item on its discounted value, so the discount has to be pushed
// down to the item or item_tax won't reconcile with tax_total.
function buildOrderItemPayload(orderItem, menuItem, order, cache, unitDiscount) {
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
    let addonItemId = "";
    for (const group of menuItem?.addonGroups || []) {
      const matched = group.addons?.find((a) => a.name === addon.name);
      if (matched) {
        addonItemId = matched.petpoojaAddonItemId || "";
        break;
      }
    }
    // group_id/group_name are both required by the spec, and the cached
    // catalogue is the only place the numeric group id exists. group_id goes
    // out as an int while every sibling id is a string — that is Petpooja's
    // own inconsistency, mirrored deliberately.
    const cached = cache?.addonItems?.get(String(addonItemId));
    return {
      id: addonItemId,
      name: addon.name,
      group_name: cached?.groupName || addon.groupName || "",
      price: String(addon.price),
      group_id: cached?.groupId ?? 0,
      quantity: "1",
    };
  });

  const itemId = menuItem?.petpooja?.itemId || "";
  const cacheItem = cache?.items?.get(String(itemId));

  // price/final_price are per UNIT; item_tax covers the whole quantity.
  const unitPrice = round2(orderItem.price);
  const unitFinal = round2(unitPrice - unitDiscount);
  const taxBase = round2(unitFinal * orderItem.quantity);

  return {
    id: itemId,
    name: orderItem.name,
    // Addons are NOT folded into price. The spec's prose says they are, but
    // its own worked example keeps them separate (a 110 pizza with a 10 addon
    // still lists price 110), and the separate form is what Petpooja reviewed
    // and approved for this integration on 2026-10-05. They are still counted
    // in the order total below.
    price: String(unitPrice),
    final_price: String(unitFinal),
    quantity: String(orderItem.quantity),
    gst_liability: "restaurant",
    item_tax: buildItemTaxLines(taxBase, cacheItem, menuItem, order, cache),
    tax_inclusive: cacheItem?.tax_inclusive ?? false,
    item_discount: unitDiscount ? String(round2(unitDiscount)) : "",
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
function buildSaveOrderPayload(order, restaurant, customer, callbackUrl, menuItemsById, cache) {
  const petpooja = restaurant.posIntegration.petpooja;
  const { datePart, timePart, combined } = formatDateTime(order.scheduledFor || order.createdAt);

  // Spread the order-level discount across lines by their share of the
  // subtotal, so each item can carry its own item_discount (Petpooja taxes
  // post-discount). item_discount is PER UNIT and must round to paise, so a
  // line of qty 2 can't always absorb an odd remainder — the last line takes
  // up whatever slack rounding leaves, and discount_total below is then
  // derived from what was actually applied rather than from
  // pricing.discount. A header that disagrees with its own item lines is
  // worse than one that's a paisa off the customer-facing figure.
  const discount = round2(order.pricing.discount || 0);
  const grossSubtotal = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  let discountAssigned = 0;
  const unitDiscounts = order.items.map((item, idx) => {
    if (!discount || !grossSubtotal) return 0;
    const isLast = idx === order.items.length - 1;
    const lineDiscount = isLast
      ? round2(discount - discountAssigned)
      : round2((discount * (item.price * item.quantity)) / grossSubtotal);
    const unit = round2(lineDiscount / item.quantity);
    discountAssigned = round2(discountAssigned + round2(unit * item.quantity));
    return unit;
  });
  const appliedDiscount = discountAssigned;

  const orderItems = order.items.map((item, idx) =>
    buildOrderItemPayload(item, menuItemsById[String(item.menuItem)], order, cache, unitDiscounts[idx])
  );

  const taxDetails = aggregateTaxDetails(orderItems);

  // tax_total is derived from the lines we actually sent rather than from
  // order.pricing.taxAmount — our own tax is a flat percentage on the
  // subtotal, Petpooja's is per-item on discounted values, and a header that
  // disagrees with its own Tax.details is exactly the kind of mismatch their
  // reviewer flags.
  const taxTotal = round2(taxDetails.reduce((s, t) => s + Number(t.tax), 0));

  const itemsFinalTotal = orderItems.reduce(
    (s, i) => s + Number(i.final_price) * Number(i.quantity),
    0
  );
  // Addons go out with quantity "1" per line, so they are counted once each
  // here too — keep this in step with buildOrderItemPayload if that changes.
  const addonsTotal = orderItems.reduce(
    (s, i) => s + (i.AddonItem?.details || []).reduce((a, x) => a + Number(x.price || 0), 0),
    0
  );

  // Petpooja's "Total" should only be the amount due to the restaurant —
  // deliveryFee (paid to Flash), platformFee and tip (ours/the rider's) are
  // deliberately excluded, unlike order.pricing.total which is customer-facing.
  const restaurantDueTotal = round2(
    itemsFinalTotal + addonsTotal + taxTotal + (order.pricing.packagingCharge || 0)
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
            discount_total: String(appliedDiscount),
            discount_type: "F",
            tax_total: String(taxTotal),
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

  // Optional: without it the payload still builds, just with weaker tax ids
  // (see buildItemTaxLines) and no addon group ids — so log loudly rather
  // than failing an otherwise-valid order.
  const cacheDoc = await PetpoojaMenuCache.findOne({ restaurant: restaurant._id }).lean();
  if (!cacheDoc?.raw) {
    console.warn(
      `[Petpooja] No cached menu for restaurant ${restaurant._id} — falling back to manual id mapping. Trigger a Menu Push to fix.`
    );
  }
  const cache = cacheDoc?.raw ? indexMenuCache(cacheDoc.raw) : null;

  const payload = buildSaveOrderPayload(order, restaurant, customer, callbackUrl, menuItemsById, cache);
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
  indexMenuCache,
};
