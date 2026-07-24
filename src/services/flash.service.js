const axios = require("axios");

const FLASH_BASE_URL = process.env.FLASH_BASE_URL || "https://riderapi-staging.uengage.in";
const FLASH_STORE_ID = process.env.FLASH_STORE_ID || "89";
const FLASH_ACCESS_TOKEN = process.env.FLASH_ACCESS_TOKEN || "grdgedhs";

const headers = {
  "Content-Type": "application/json",
  "access-token": FLASH_ACCESS_TOKEN,
};

// POST /getServiceability
// Returns { riderServiceAble, locationServiceAble, payouts: { total, price, tax } }
async function checkServiceability(pickupLat, pickupLng, dropLat, dropLng) {
  const res = await axios.post(
    `${FLASH_BASE_URL}/getServiceability`,
    {
      store_id: FLASH_STORE_ID,
      pickupDetails: { latitude: String(pickupLat), longitude: String(pickupLng) },
      dropDetails:   { latitude: String(dropLat),   longitude: String(dropLng)   },
    },
    { headers, timeout: 10000 }
  );
  return res.data;
}

// POST /createTask
// Returns { status, TaskId, vendor_order_id, message, Status_code }
async function createTask(order, restaurant, customer) {
  const res = await axios.post(
    `${FLASH_BASE_URL}/createTask`,
    {
      storeId: FLASH_STORE_ID,
      order_details: {
        order_total: order.pricing.total,
        paid: order.paymentStatus === "paid" ? "true" : "false",
        vendor_order_id: String(order._id),
        order_source: "app",
        customer_orderId: order.orderNumber,
      },
      pickup_details: {
        name: restaurant.name,
        contact_number: restaurant.contact?.phone || "",
        latitude: restaurant.address.lat,
        longitude: restaurant.address.lng,
        address: restaurant.address.fullAddress || "",
        city: restaurant.address.city || "",
        state: restaurant.address.state || "",
      },
      drop_details: {
        name: customer.name,
        contact_number: customer.phone || "",
        latitude: order.deliveryAddress.lat,
        longitude: order.deliveryAddress.lng,
        address: order.deliveryAddress.fullAddress || "",
        city: "",
      },
      order_items: order.items.map((item) => ({
        id: String(item.menuItem),
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    },
    { headers, timeout: 15000 }
  );
  return res.data;
}

// POST /cancelTask
async function cancelTask(taskId) {
  const res = await axios.post(
    `${FLASH_BASE_URL}/cancelTask`,
    { storeId: FLASH_STORE_ID, taskId },
    { headers, timeout: 10000 }
  );
  return res.data;
}

// POST /trackTaskStatus
async function trackTask(taskId) {
  const res = await axios.post(
    `${FLASH_BASE_URL}/trackTaskStatus`,
    { storeId: FLASH_STORE_ID, taskId },
    { headers, timeout: 10000 }
  );
  return res.data;
}

module.exports = { checkServiceability, createTask, cancelTask, trackTask };
