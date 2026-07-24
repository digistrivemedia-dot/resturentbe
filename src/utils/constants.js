const USER_ROLES = {
  CUSTOMER: "customer",
  RESTAURANT_OWNER: "restaurant_owner",
  SUPER_ADMIN: "super_admin",
};

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

const RESTAURANT_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CLOSED: "closed",
};

const COUPON_TYPE = {
  PERCENTAGE: "percentage",
  FLAT: "flat",
  FREE_DELIVERY: "free_delivery",
};

const COUPON_SCOPE = {
  PLATFORM: "platform",
  RESTAURANT: "restaurant",
};

module.exports = {
  USER_ROLES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  RESTAURANT_STATUS,
  COUPON_TYPE,
  COUPON_SCOPE,
};
