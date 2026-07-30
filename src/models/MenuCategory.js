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
  },
  { timestamps: true }
);

menuCategorySchema.index({ restaurant: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("MenuCategory", menuCategorySchema);
