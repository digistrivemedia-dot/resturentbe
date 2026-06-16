const mongoose = require("mongoose");

const addonSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  isDefault: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
});

const addonGroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  isRequired: { type: Boolean, default: false },
  minSelection: { type: Number, default: 0 },
  maxSelection: { type: Number, default: 1 },
  addons: [addonSchema],
});

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  discountedPrice: Number,
});

const menuItemSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: String,
    price: {
      type: Number,
      required: true,
    },
    discountedPrice: Number,
    isVeg: {
      type: Boolean,
      default: true,
    },
    isVegan: {
      type: Boolean,
      default: false,
    },
    spiceLevel: {
      type: String,
      enum: ["mild", "medium", "hot", "extra_hot"],
      default: "mild",
    },
    preparationTime: {
      type: Number,
      default: 15,
    },
    tags: [String],
    addonGroups: [addonGroupSchema],
    variants: [variantSchema],
    nutritionalInfo: {
      calories: Number,
      protein: Number,
      carbs: Number,
      fat: Number,
    },
    allergens: [String],
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isBestseller: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Indexes
menuItemSchema.index({ restaurant: 1, category: 1 });
menuItemSchema.index({ restaurant: 1, isAvailable: 1 });
menuItemSchema.index({ restaurant: 1, status: 1, sortOrder: 1 });
menuItemSchema.index({ name: "text", description: "text", category: "text" });

module.exports = mongoose.model("MenuItem", menuItemSchema);
