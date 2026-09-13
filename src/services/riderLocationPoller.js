const Order = require("../models/Order");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const { trackTask } = require("./flash.service");

const POLL_INTERVAL_MS = 15000;

// Flash's webhook only fires on discrete status milestones (rider assigned,
// arrived, picked up, delivered) — each one happens to carry a location
// snapshot, but there's nothing pushing updates while the rider is actually
// driving between those points. That's why the map sits still even though
// Flash's own tracking page (a separate system, polling their live feed
// directly) shows real movement. trackTaskStatus is the endpoint built for
// polling a rider's current position on demand — this loop is what actually
// calls it, on a timer, for every order currently out for delivery, and
// pushes the result through the same order_location_updated event the
// webhook already uses so the existing map code needs no changes at all.
let intervalHandle = null;
let isPolling = false;

function emitLocationUpdate(customerId, orderId, location) {
  try {
    const io = getIo();
    if (!io) return;
    io.to(`customer:${customerId}`).emit("order_location_updated", { orderId, location });
  } catch (e) {}
}

async function pollOne(order) {
  const taskId = order.deliveryTracking?.flash?.taskId;
  if (!taskId) return;

  let result;
  try {
    result = await trackTask(taskId);
  } catch (err) {
    console.warn(`[RiderLocationPoller] trackTaskStatus failed for order ${order._id} (task ${taskId}):`, err.message);
    return;
  }

  const raw = result?.data || {};
  // Flash returns these as empty strings ("") when no rider is actively
  // moving yet (e.g. still ACCEPTED) — not a value worth writing.
  if (!raw.latitude || !raw.longitude) return;

  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return;

  const location = { lat, lng, updatedAt: new Date() };

  try {
    await Order.updateOne(
      { _id: order._id },
      { $set: { "deliveryTracking.currentLocation": location } }
    );
  } catch (err) {
    console.warn(`[RiderLocationPoller] Failed to save location for order ${order._id}:`, err.message);
    return;
  }

  emitLocationUpdate(order.customer, order._id, location);
}

async function pollActiveDeliveries() {
  if (isPolling) return; // previous cycle still running (e.g. Flash is slow) — skip, don't overlap
  isPolling = true;
  try {
    const activeOrders = await Order.find({
      status: { $in: [ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY] },
      orderType: "delivery",
      "deliveryTracking.flash.taskId": { $exists: true, $ne: null },
    })
      .select("_id customer deliveryTracking.flash.taskId")
      .lean();

    if (activeOrders.length === 0) return;

    await Promise.all(activeOrders.map(pollOne));
  } catch (err) {
    console.error("[RiderLocationPoller] Poll cycle failed:", err.message);
  } finally {
    isPolling = false;
  }
}

function startRiderLocationPolling() {
  if (intervalHandle) return; // already started
  intervalHandle = setInterval(pollActiveDeliveries, POLL_INTERVAL_MS);
  console.log(`[RiderLocationPoller] Started — polling active deliveries every ${POLL_INTERVAL_MS / 1000}s`);
}

module.exports = { startRiderLocationPolling };
