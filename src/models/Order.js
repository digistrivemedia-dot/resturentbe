const mongoose = require("mongoose");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../utils/constants");

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    items: [
      {
        menuItem: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "MenuItem",
        },
        name: String,
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
        variant: {
          name: String,
          price: Number,
        },
        addons: [
          {
            groupName: String,
            name: String,
            price: Number,
          },
        ],
        specialInstructions: String,
        itemTotal: { type: Number, required: true },
        isVeg: Boolean,
      },
    ],
    pricing: {
      subtotal: { type: Number, required: true },
      deliveryFee: { type: Number, default: 0 },
      taxAmount: { type: Number, default: 0 },
      taxPercentage: { type: Number, default: 5 },
      discount: { type: Number, default: 0 },
      couponCode: String,
      couponDiscount: { type: Number, default: 0 },
      packagingCharge: { type: Number, default: 0 },
      platformFee: { type: Number, default: 3 },
      tip: { type: Number, default: 0 },
      total: { type: Number, required: true },
    },
    deliveryAddress: {
      label: String,
      fullAddress: String,
      landmark: String,
      lat: Number,
      lng: Number,
    },
    orderType: {
      type: String,
      enum: ["delivery", "pickup"],
      default: "delivery",
    },
    scheduledFor: Date,
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PLACED,
    },
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        note: String,
      },
    ],
    paymentMethod: {
      type: String,
      enum: ["online", "cod", "wallet"],
      default: "cod",
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    paymentId: String,
    cancellation: {
      cancelledBy: {
        type: String,
        enum: ["customer", "restaurant", "admin"],
      },
      reason: String,
      refundAmount: Number,
      refundStatus: {
        type: String,
        enum: ["pending", "processed"],
      },
    },
    deliveryTracking: {
      deliveryPartner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      assignedAt: Date,
      pickedUpAt: Date,
      deliveredAt: Date,
      currentLocation: {
        lat: Number,
        lng: Number,
      },
    },
    rating: {
      foodRating: { type: Number, min: 1, max: 5 },
      deliveryRating: { type: Number, min: 1, max: 5 },
      review: String,
      ratedAt: Date,
    },
    estimatedDeliveryTime: Number,
  },
  { timestamps: true }
);

// Auto-generate order number: ORD-YYYYMMDD-XXX
orderSchema.pre("save", async function () {
  if (this.isNew && !this.orderNumber) {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const prefix = `ORD-${dateStr}-`;
    const lastOrder = await mongoose
      .model("Order")
      .findOne({ orderNumber: { $regex: `^${prefix}` } })
      .sort({ orderNumber: -1 })
      .lean();

    let seq = 1;
    if (lastOrder) {
      const lastSeq = parseInt(lastOrder.orderNumber.split("-").pop(), 10);
      seq = lastSeq + 1;
    }
    this.orderNumber = `${prefix}${String(seq).padStart(3, "0")}`;
  }

  // Add to statusHistory on status change (skip if controller already pushed)
  if (this.isModified("status")) {
    const lastEntry = this.statusHistory[this.statusHistory.length - 1];
    if (!lastEntry || lastEntry.status !== this.status) {
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date(),
      });
    }
  }

});

// Indexes
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, status: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
