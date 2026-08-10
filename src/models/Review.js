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
    // One rating per distinct menu item ordered — the granular data the
    // restaurant-facing "which dishes are doing poorly" view is built on.
    itemRatings: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
        name: String,
        rating: { type: Number, min: 1, max: 5 },
        _id: false,
      },
    ],
    // Derived: average of itemRatings, rounded — kept so existing filter/sort/display
    // by "overall rating" (both admin and customer-facing) keeps working unchanged.
    foodRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    deliveryRating: Number,
    review: String,
    tags: [String],
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
