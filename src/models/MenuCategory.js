const mongoose = require("mongoose");

// Menu categories aren't their own collection elsewhere — they're derived from
// distinct MenuItem.category strings. This side-table just attaches an optional
// image to a (restaurant, category name) pair without changing that pattern.
const menuCategorySchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: String,
    // Manual master switch — off always wins over any schedule below.
    isEnabled: {
      type: Boolean,
      default: true,
    },
    // Daily recurring windows in "HH:mm" 24h local time (Asia/Kolkata). Empty =
    // no time restriction (available whenever isEnabled is true). Multiple
    // windows are OR'd together; a window may wrap midnight (e.g. 22:00-02:00).
    schedules: [
      {
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

menuCategorySchema.index({ restaurant: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("MenuCategory", menuCategorySchema);
