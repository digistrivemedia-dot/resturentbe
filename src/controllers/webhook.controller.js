const crypto = require("crypto");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");

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
      console.log(`[Razorpay Webhook] Order ${order.orderNumber} payment failed`);
    }
  } catch (err) {
    console.error("[Razorpay Webhook] Error:", err.message);
  }
};

module.exports = { handleFlashWebhook, handleRazorpayWebhook };
