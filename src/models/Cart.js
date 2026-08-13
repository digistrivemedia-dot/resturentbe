const mongoose = require("mongoose");

// Mirrors the client's local cart state for a logged-in customer — used to
// recover a cart across devices/sessions, and as the source of truth for
// abandoned-cart automations (e.g. WhatsApp reminders via n8n). Items are
// stored loosely (not a strict sub-schema) since the client assembles them
// slightly differently across several add-to-cart entry points; this store
// is a mirror for visibility, not the transactional record — that's the
// Order created at actual checkout.
const cartSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    items: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    coupon: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    tip: {
      type: Number,
      default: 0,
    },
    orderType: {
      type: String,
      default: "delivery",
    },
    orderTypeLocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cart", cartSchema);
