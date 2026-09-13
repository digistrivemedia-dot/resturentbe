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
};

const COUPON_SCOPE = {
  PLATFORM: "platform",
  RESTAURANT: "restaurant",
};

module.exports = {
  ORDER_STATUS,
  PAYMENT_STATUS,
  COUPON_TYPE,
  COUPON_SCOPE,
};
