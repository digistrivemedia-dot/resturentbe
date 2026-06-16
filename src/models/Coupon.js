const mongoose = require("mongoose");
const { COUPON_TYPE, COUPON_SCOPE } = require("../utils/constants");

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: String,
    type: {
      type: String,
      enum: Object.values(COUPON_TYPE),
      required: true,
    },
    value: {
      type: Number,
      required: true,
    },
    maxDiscount: Number,
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    scope: {
      type: String,
      enum: Object.values(COUPON_SCOPE),
      default: COUPON_SCOPE.PLATFORM,
    },
    usageLimit: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    perUserLimit: {
      type: Number,
      default: 1,
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    applicableCuisines: [String],
    applicablePaymentMethods: [String],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes
couponSchema.index({ code: 1 });
couponSchema.index({ isActive: 1, validUntil: 1 });
couponSchema.index({ restaurant: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
