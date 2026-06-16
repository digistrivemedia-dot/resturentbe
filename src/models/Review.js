const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    foodRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    deliveryRating: Number,
    review: String,
    images: [String],
    reply: {
      text: String,
      repliedAt: Date,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ restaurant: 1, createdAt: -1 });
reviewSchema.index({ customer: 1 });

module.exports = mongoose.model("Review", reviewSchema);
