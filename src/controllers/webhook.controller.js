const Order = require("../models/Order");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");

// Flash status_code → our Order.status
// Only statuses that require a status change are mapped here
const FLASH_TO_ORDER_STATUS = {
  ALLOTTED:    ORDER_STATUS.OUT_FOR_DELIVERY,
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

// POST /api/v1/webhooks/flash
// Flash pushes delivery status updates here
const handleFlashWebhook = async (req, res) => {
  try {
    const { status_code, data = {}, message } = req.body;

    // Always respond 200 quickly so Flash doesn't retry
    res.status(200).json({ status: true, message: "Webhook Processed" });

    if (!status_code || !data.orderId) {
      console.warn("[Flash Webhook] Missing status_code or orderId", req.body);
      return;
    }

    const order = await Order.findById(data.orderId);
    if (!order) {
      console.warn("[Flash Webhook] Order not found:", data.orderId);
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

    // Apply order status change if this status requires one
    const newOrderStatus = FLASH_TO_ORDER_STATUS[status_code];
    if (newOrderStatus && order.status !== newOrderStatus) {
      order.status = newOrderStatus;
      order.statusHistory.push({
        status: newOrderStatus,
        timestamp: new Date(),
        note: `Flash: ${status_code}`,
      });

      if (status_code === "DISPATCHED" || status_code === "ALLOTTED") {
        order.deliveryTracking.assignedAt = order.deliveryTracking.assignedAt || new Date();
      }
      if (status_code === "DELIVERED") {
        order.deliveryTracking.deliveredAt = new Date();
      }
    }

    order.markModified("deliveryTracking");
    await order.save();

    emitOrderUpdate(order.restaurant, order.customer, order);

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
    const crypto = require("crypto");
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
