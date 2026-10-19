// Customer-facing brand name. Outlets are named internally per branch
// ("SIC Varthur"), but a guest scanning a payment QR must see the name they
// know the cafe by — mirrors APP_NAME in frontend/src/constants.
const BRAND_NAME = "Sri Isha Cafe";

const ORDER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  PLACED: "placed",
  CONFIRMED: "confirmed",
  PREPARING: "preparing",
  READY: "ready",
  PICKED_UP: "picked_up",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
};

const COUPON_TYPE = {
  PERCENTAGE: "percentage",
  FLAT: "flat",
  // value is always 0 — the discount equals the delivery fee, resolved at
  // order time once the fee is known (order.controller.js).
  FREE_DELIVERY: "free_delivery",
};

const COUPON_SCOPE = {
  PLATFORM: "platform",
  RESTAURANT: "restaurant",
};

module.exports = {
  BRAND_NAME,
  ORDER_STATUS,
  PAYMENT_STATUS,
  COUPON_TYPE,
  COUPON_SCOPE,
};
