// Flash rider dispatch, shared by the two things that can mark food ready:
// the restaurant dashboard (restaurant.order.controller.js) and Petpooja's
// order callback (webhook.controller.js). Both must apply the same guards, so
// this lives in one place rather than being copied into the webhook — a copy
// would be the one nobody tests, and it would drift.
//
// Mutates order.deliveryTracking.flash and returns an outcome; the CALLER
// saves the order, since each caller has its own save/emit sequence.
const Order = require("../models/Order");
const { createTask } = require("./flash.service");

// Why a task-level guard rather than the caller's status-level claim: the
// dashboard's atomic updateOne is filtered on the previous *status*, which
// protects two dashboard clicks from each other but not a dashboard click
// racing Petpooja's callback — those move through different code paths and
// can both read a pre-dispatch order. taskId is the only value that proves a
// rider has actually been requested. Two riders for one order has already
// happened once in production from a double-click; two trigger sources make
// it likelier, not less.
async function alreadyDispatched(orderId) {
  const fresh = await Order.findById(orderId)
    .select("deliveryTracking.flash.taskId")
    .lean();
  return !!fresh?.deliveryTracking?.flash?.taskId;
}

/**
 * Request a Flash rider for an order whose food is ready.
 *
 * @returns {Promise<{outcome: string, reason?: string, taskId?: string}>}
 *   outcome is one of:
 *     "dispatched"       — Flash accepted, taskId stored
 *     "already"          — a rider was already requested, nothing done
 *     "manual_delivery"  — COD: the restaurant's own riders handle it
 *     "not_delivery"     — pickup/dine-in, no rider needed
 *     "blocked"          — missing data Flash hard-rejects; `reason` is set
 *     "failed"           — Flash refused or errored; `reason` is set
 */
async function dispatchFlashRider(order, restaurant, { source = "dashboard" } = {}) {
  if (order.orderType !== "delivery") {
    return { outcome: "not_delivery" };
  }

  order.deliveryTracking = order.deliveryTracking || {};

  if (order.deliveryTracking.flash?.taskId || (await alreadyDispatched(order._id))) {
    console.log(`[Flash] ${order.orderNumber} already has a rider task — ${source} dispatch skipped`);
    return { outcome: "already", taskId: order.deliveryTracking.flash?.taskId };
  }

  // COD is delivered by the restaurant's own riders by arrangement, and Flash's
  // 3PL service rejects unpaid orders outright anyway. This is a normal
  // outcome, NOT a dispatch failure — recording it as one made every COD order
  // look broken in the logs and on the dashboard.
  if (order.paymentStatus !== "paid") {
    console.log(`[Flash] ${order.orderNumber} is COD — handled by the restaurant's own delivery, no Flash task`);
    order.deliveryTracking.flash = {
      status: "MANUAL_DELIVERY",
    };
    return { outcome: "manual_delivery" };
  }

  // Flash's API hard-rejects the request when these are blank (confirmed via
  // its own validation error), so check before calling rather than after.
  const missing = [];
  if (!restaurant?.contact?.phone) missing.push("the restaurant's contact phone number (Settings > Location & Hours)");
  if (!restaurant?.address?.fullAddress) missing.push("the restaurant's address (Settings > Location & Hours)");
  // drop_details.contact_number comes from the customer's own account phone —
  // accounts created via Google/OTP sign-in never require one, so this is a
  // real, expected gap for some customers, not a code bug.
  if (!order.customer?.phone) missing.push("the customer's phone number on their account");
  // Checkout doesn't require a pinned map location on saved addresses (by
  // design), so an order can reach here with no lat/lng. Flash's
  // drop_details.latitude/longitude would be undefined and rejected.
  if (typeof order.deliveryAddress?.lat !== "number" || typeof order.deliveryAddress?.lng !== "number") {
    missing.push("a map location on the customer's delivery address");
  }

  if (missing.length > 0) {
    const reason = `Missing ${missing.join(" and ")} — dispatch can't be requested until this is set, then retry`;
    console.warn(`[Flash] Skipped dispatch for ${order.orderNumber} — ${reason}`);
    order.deliveryTracking.flash = { status: "CANCELLED", dispatchFailedReason: reason };
    return { outcome: "blocked", reason };
  }

  console.log(`[Flash] Dispatching rider for ${order.orderNumber} via ${source} (restaurant: ${restaurant.name})`);
  try {
    const result = await createTask(order, restaurant, order.customer);
    console.log(`[Flash] createTask response for ${order.orderNumber}:`, JSON.stringify(result));

    if (result.status) {
      const taskId = result.TaskId || result.taskId;
      order.deliveryTracking.flash = {
        taskId,
        status: result.Status_code,
        dispatchedAt: new Date(),
      };
      console.log(`[Flash] Task created for ${order.orderNumber}: ${taskId}`);
      return { outcome: "dispatched", taskId };
    }

    // Validation failures come back as msg: { field: "error text" } rather than
    // a single message string — surface those too, not just a generic fallback
    // that would mislabel a bad payload as "no rider".
    const reason =
      result.message ||
      (result.msg && typeof result.msg === "object" ? Object.values(result.msg).join("; ") : result.msg) ||
      "Rider not available";
    order.deliveryTracking.flash = {
      status: result.Status_code || "CANCELLED",
      dispatchFailedReason: reason,
    };
    console.warn(`[Flash] Task creation failed for ${order.orderNumber}: ${reason}`);
    return { outcome: "failed", reason };
  } catch (err) {
    order.deliveryTracking.flash = { dispatchFailedReason: err.message };
    console.error(`[Flash] createTask error for order ${order.orderNumber}:`, err.message);
    return { outcome: "failed", reason: err.message };
  }
}

module.exports = { dispatchFlashRider };
