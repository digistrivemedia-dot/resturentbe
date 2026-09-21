const mongoose = require("mongoose");

const addonSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  isDefault: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
  // Petpooja's own addon item ID — needed in Save Order's addon_items[] so
  // their POS recognizes which addon was picked. Filled in manually per
  // addon, matched against what Petpooja's dashboard shows for this item.
  petpoojaAddonItemId: String,
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
  // Petpooja's own variation ID — needed as order_items[].variation_id in
  // Save Order. Filled in manually, matched against Petpooja's dashboard.
  petpoojaVariationId: String,
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
      enum: ["none", "mild", "medium", "hot", "extra_hot"],
      default: "none",
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
    // Petpooja's own catalog item ID + tax rates for this item, needed to
    // push this item in a Save Order call. Filled in manually (per the
    // decision to hand-map just the items used for Petpooja's test orders,
    // not a full menu sync) by matching against Petpooja's dashboard.
    // taxes left empty = petpooja.service.js falls back to splitting the
    // order's flat tax percentage evenly into CGST/SGST for this item.
    petpooja: {
      itemId: String,
      taxes: [
        {
          id: String,
          name: String, // e.g. "CGST", "SGST"
          taxPercentage: Number,
          _id: false,
        },
      ],
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
