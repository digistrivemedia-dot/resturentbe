const crypto = require("crypto");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const PetpoojaMenuCache = require("../models/PetpoojaMenuCache");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const notifyAdmin = require("../utils/notifyAdmin");

// Flash calls our webhook with "Authorization: Bearer <FLASH_WEBHOOK_TOKEN>" —
// configured in the Flash dashboard's Configure Webhook section.
function isValidFlashWebhook(req) {
  const token = process.env.FLASH_WEBHOOK_TOKEN;
  if (!token) return true; // not configured yet — allow through (matches pre-webhook-auth behavior)

  const received = req.headers["authorization"] || "";
  const expected = `Bearer ${token}`;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

// Flash status_code → our Order.status. Only statuses that require a status
// change are mapped here.
// ALLOTTED deliberately does NOT map to out_for_delivery — per Flash's docs
// it only means a rider has been assigned and is heading to the restaurant,
// not that the food has left yet. The order correctly stays at "ready" (shown
// to the customer as "waiting for delivery partner") through ALLOTTED and
// ARRIVED; DISPATCHED ("order is picked up by the rider") is the real
// out-for-delivery moment.
const FLASH_TO_ORDER_STATUS = {
  DISPATCHED:  ORDER_STATUS.OUT_FOR_DELIVERY,
  DELIVERED:   ORDER_STATUS.DELIVERED,
  RTO_COMPLETE: ORDER_STATUS.CANCELLED,
};

function emitOrderUpdate(restaurantId, customerId, order) {
  try {
    const io = getIo();
    if (!io) return;
    io.to(`restaurant:${restaurantId}`).emit("order_updated", { order });
    io.to(`customer:${customerId}`).emit("order_status_updated", { order });
  } catch (e) {}
}

function emitLocationUpdate(customerId, orderId, location) {
  try {
    const io = getIo();
    if (!io) return;
    io.to(`customer:${customerId}`).emit("order_location_updated", { orderId, location });
  } catch (e) {}
}

// Confirmed against Flash's real Callback API docs: data.latitude/longitude
// are sent as strings on every status push. The extra fallback field names
// are just cheap defensive coverage in case that ever changes.
function extractRiderLocation(data) {
  const lat = data.latitude ?? data.lat ?? data.rider_lat ?? data.current_lat;
  const lng = data.longitude ?? data.lng ?? data.rider_lng ?? data.current_lng;
  if (typeof lat !== "number" && typeof lat !== "string") return null;
  if (typeof lng !== "number" && typeof lng !== "string") return null;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

// POST /api/v1/webhooks/flash
// Flash pushes delivery status updates here
const handleFlashWebhook = async (req, res) => {
  try {
    if (!isValidFlashWebhook(req)) {
      console.warn("[Flash Webhook] Rejected — missing/invalid Authorization header");
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }

    const { status_code, data = {}, message } = req.body;

    // Always respond 200 quickly so Flash doesn't retry
    res.status(200).json({ status: true, message: "Webhook Processed" });

    if (!status_code || (!data.orderId && !data.taskId)) {
      console.warn("[Flash Webhook] Missing status_code or an order/task identifier", req.body);
      return;
    }

    // orderId is documented as Flash's callback identifier, but we've never
    // confirmed whether it's literally the vendor_order_id we sent (our raw
    // Mongo _id) or something Flash-generated — their trackTaskStatus example
    // shows a vendor_order_id that doesn't look like a bare ObjectId. Try the
    // direct id lookup first, but fall back to matching on taskId (which we
    // stored ourselves from createTask's own response, so it's a value we
    // know for certain is correct) rather than silently dropping the update.
    let order = null;
    if (data.orderId && mongoose.Types.ObjectId.isValid(data.orderId)) {
      order = await Order.findById(data.orderId);
    }
    if (!order && data.taskId) {
      order = await Order.findOne({ "deliveryTracking.flash.taskId": data.taskId });
    }
    if (!order) {
      console.warn("[Flash Webhook] Order not found for orderId/taskId:", data.orderId, data.taskId);
      return;
    }

    // Update flash tracking info
    if (!order.deliveryTracking) order.deliveryTracking = {};
    if (!order.deliveryTracking.flash) order.deliveryTracking.flash = {};

    order.deliveryTracking.flash.status = status_code;
    if (data.taskId)       order.deliveryTracking.flash.taskId      = data.taskId;
    if (data.rider_name)   order.deliveryTracking.flash.riderName   = data.rider_name;
    if (data.rider_contact) order.deliveryTracking.flash.riderContact = data.rider_contact;
    if (data.tracking_url) order.deliveryTracking.flash.trackingUrl = data.tracking_url;
    if (data.rto_reason)   order.deliveryTracking.flash.rtoReason   = data.rto_reason;

    const riderLocation = extractRiderLocation(data);
    if (riderLocation) {
      order.deliveryTracking.currentLocation = { ...riderLocation, updatedAt: new Date() };
    }

    // These timestamps are independent of whether order.status itself
    // changes — ALLOTTED (rider assigned) intentionally doesn't move the
    // order status, but we still want to record when it happened.
    if (status_code === "DISPATCHED" || status_code === "ALLOTTED") {
      order.deliveryTracking.assignedAt = order.deliveryTracking.assignedAt || new Date();
    }
    if (status_code === "DELIVERED") {
      order.deliveryTracking.deliveredAt = new Date();
    }

    // Apply order status change if this status requires one
    const newOrderStatus = FLASH_TO_ORDER_STATUS[status_code];
    if (newOrderStatus && order.status !== newOrderStatus) {
      order.status = newOrderStatus;
      order.statusHistory.push({
        status: newOrderStatus,
        timestamp: new Date(),
        note: `Flash: ${status_code}`,
      });
    }

    order.markModified("deliveryTracking");
    await order.save();

    emitOrderUpdate(order.restaurant, order.customer, order);
    if (riderLocation) {
      emitLocationUpdate(order.customer, order._id, order.deliveryTracking.currentLocation);
    }

    console.log(`[Flash Webhook] Order ${order.orderNumber} → ${status_code}`);
  } catch (err) {
    console.error("[Flash Webhook] Error:", err.message);
  }
};

// POST /api/v1/webhooks/razorpay
// Backup payment verification via Razorpay webhooks
const handleRazorpayWebhook = async (req, res) => {
  try {
    // Always respond 200 quickly so Razorpay doesn't retry
    res.status(200).json({ status: "ok" });

    // Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest("hex");
      if (expectedSignature !== signature) {
        console.warn("[Razorpay Webhook] Invalid signature");
        return;
      }
    }

    const { event, payload } = req.body;

    if (event === "payment.captured") {
      const payment = payload.payment.entity;
      const order = await Order.findOne({ razorpayOrderId: payment.order_id });
      if (!order || order.paymentStatus === "paid") return;

      order.paymentId = payment.id;
      order.paymentStatus = "paid";
      if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
        order.status = ORDER_STATUS.CONFIRMED;
        order.statusHistory.push(
          { status: ORDER_STATUS.PLACED, timestamp: new Date(), note: "Payment captured via webhook" },
          { status: ORDER_STATUS.CONFIRMED, timestamp: new Date(), note: "Auto-confirmed via webhook" }
        );
      }
      await order.save();
      await Cart.deleteOne({ customer: order.customer }).catch(() => {});
      if (order.isFirstFourOrder) {
        await User.updateOne({ _id: order.customer }, { $inc: { newCustomerOrdersUsed: 1 } }).catch(() => {});
      }
      emitOrderUpdate(order.restaurant, order.customer, order);
      console.log(`[Razorpay Webhook] Order ${order.orderNumber} payment captured`);
    }

    if (event === "payment.failed") {
      const payment = payload.payment.entity;
      const order = await Order.findOne({ razorpayOrderId: payment.order_id });
      if (!order || order.paymentStatus === "paid") return;
      order.paymentStatus = "failed";
      await order.save();
      notifyAdmin("paymentFailure", {
        subject: `Payment failed — order #${order.orderNumber}`,
        html: `<p>Razorpay reported a failed payment for order #${order.orderNumber} (₹${order.pricing.total}).</p>`,
      });
      console.log(`[Razorpay Webhook] Order ${order.orderNumber} payment failed`);
    }
  } catch (err) {
    console.error("[Razorpay Webhook] Error:", err.message);
  }
};

// Petpooja calls this with restID/orderID/status whenever the order's state
// changes on their POS (kitchen accepts/rejects, marks food ready, etc.) —
// this is the callback_url sent with every Save Order request.
function isValidPetpoojaWebhook(req) {
  const token = process.env.PETPOOJA_WEBHOOK_TOKEN;
  if (!token) return true; // not configured yet — allow through, same as Flash's fallback

  const received = req.headers["authorization"] || "";
  const expected = `Bearer ${token}`;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

// Status-code → our ORDER_STATUS mapping. NOT confirmed by Petpooja's PDFs
// (neither doc lists the actual numeric/string codes their callback sends —
// only that it can "accept, mark food as ready, or reject") — this is a
// best-effort guess to verify during sandbox testing. Anything unrecognized
// is logged and stored as lastCallbackStatus without changing order.status,
// so an unmapped code never crashes or silently misfires a transition.
const PETPOOJA_TO_ORDER_STATUS = {
  "-1": ORDER_STATUS.CANCELLED,
  "1": ORDER_STATUS.CONFIRMED,
  "2": ORDER_STATUS.CONFIRMED,
  "3": ORDER_STATUS.CONFIRMED,
  "4": ORDER_STATUS.PREPARING,
  "5": ORDER_STATUS.READY,
  "10": ORDER_STATUS.DELIVERED,
};

// Rank order so a delayed/out-of-order callback can't regress an order that
// already moved further via the restaurant portal (or vice versa).
const STATUS_RANK = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// POST /api/v1/webhooks/petpooja/order-callback
const handlePetpoojaOrderCallback = async (req, res) => {
  try {
    if (!isValidPetpoojaWebhook(req)) {
      console.warn("[Petpooja Webhook] Rejected — missing/invalid Authorization header");
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }

    // Always respond 200 quickly so Petpooja doesn't retry
    res.status(200).json({ status: true, message: "Webhook Processed" });

    const { orderID, restID, status, cancel_reason } = req.body || {};
    console.log("[Petpooja Webhook] Received:", JSON.stringify(req.body));

    if (!orderID) {
      console.warn("[Petpooja Webhook] Missing orderID", req.body);
      return;
    }

    // orderID sent with Save Order was our own order.orderNumber — that's
    // the value Petpooja should echo back here.
    const order = await Order.findOne({ orderNumber: orderID }).populate("customer", "name");
    if (!order) {
      console.warn(`[Petpooja Webhook] Order not found for orderID/restID: ${orderID} / ${restID}`);
      return;
    }

    order.petpooja = order.petpooja || {};
    order.petpooja.lastCallbackStatus = String(status ?? "");
    order.petpooja.lastCallbackAt = new Date();
    if (cancel_reason) order.petpooja.cancelReason = cancel_reason;

    const mappedStatus = PETPOOJA_TO_ORDER_STATUS[String(status)];
    if (mappedStatus) {
      const currentRank = STATUS_RANK.indexOf(order.status);
      const newRank = STATUS_RANK.indexOf(mappedStatus);
      const isCancel = mappedStatus === ORDER_STATUS.CANCELLED;
      const alreadyDelivered = order.status === ORDER_STATUS.DELIVERED;

      if ((isCancel && !alreadyDelivered) || (!isCancel && newRank >= currentRank)) {
        order.status = mappedStatus;
        order.statusHistory.push({
          status: mappedStatus,
          timestamp: new Date(),
          note: `Petpooja: status ${status}`,
        });
      } else {
        console.log(
          `[Petpooja Webhook] Ignored stale/out-of-order status ${status} for order ${order.orderNumber} (already ${order.status})`
        );
      }
    } else {
      console.warn(`[Petpooja Webhook] Unrecognized status code "${status}" — stored raw, order.status unchanged`);
    }

    await order.save();
    emitOrderUpdate(order.restaurant, order.customer?._id || order.customer, order);

    console.log(`[Petpooja Webhook] Order ${order.orderNumber} → status ${status}`);
  } catch (err) {
    console.error("[Petpooja Webhook] Error:", err.message);
  }
};

// Petpooja calls this when "Menu Trigger" is clicked on their dashboard (or
// whenever their menu changes) — it pushes their catalogue (categories,
// items, variations, addongroups, taxes) to whatever URL is set as "Menu
// Sharing Endpoint" on the Configuration page. This is the reverse direction
// of what the field name suggests: THEY push TO us, we don't fetch from them
// ("Fetch Menu API" is deprecated per their team's email — this replaces it).
//
// Payload shape isn't confirmed from either PDF we have (neither documents
// it) — stored raw/as-is rather than parsed into a strict schema. Once this
// receives a real push, log the body and adjust restID extraction below if
// it doesn't land where guessed (top-level restID, restaurantId, or
// restaurants[0].restaurantid are the common shapes across Petpooja-style
// integrations, so all three are tried).
//
// POST /api/v1/webhooks/petpooja/menu-push
const handlePetpoojaMenuPush = async (req, res) => {
  try {
    if (!isValidPetpoojaWebhook(req)) {
      console.warn("[Petpooja Menu Push] Rejected — missing/invalid Authorization header");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Always ack quickly so Petpooja doesn't retry
    res.status(200).json({ success: true, message: "Menu received" });

    const body = req.body || {};
    const restID =
      body.restID || body.restaurantId || body.restaurants?.[0]?.restaurantid || null;

    console.log("[Petpooja Menu Push] Received for restID:", restID);

    if (!restID) {
      console.warn("[Petpooja Menu Push] Could not find restID in payload — stored anyway under restID: null. Payload keys:", Object.keys(body));
    }

    const restaurant = await Restaurant.findOne({ "posIntegration.petpooja.restID": restID });
    if (!restaurant) {
      console.warn(`[Petpooja Menu Push] No restaurant linked to restID ${restID} — payload dropped`);
      return;
    }

    await PetpoojaMenuCache.findOneAndUpdate(
      { restaurant: restaurant._id },
      { restaurant: restaurant._id, restID, raw: body, receivedAt: new Date() },
      { upsert: true }
    );

    restaurant.posIntegration.petpooja.lastMenuSyncAt = new Date();
    await restaurant.save();

    console.log(`[Petpooja Menu Push] Cached menu for restaurant ${restaurant._id} (restID ${restID})`);
  } catch (err) {
    console.error("[Petpooja Menu Push] Error:", err.message);
  }
};

module.exports = {
  handleFlashWebhook,
  handleRazorpayWebhook,
  handlePetpoojaOrderCallback,
  handlePetpoojaMenuPush,
};
