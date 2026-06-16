const mongoose = require("mongoose");
const slugify = require("slugify");

const restaurantSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    logo: String,
    coverImage: String,
    images: [String],
    cuisines: [String],
    categories: [String],
    address: {
      fullAddress: String,
      area: String,
      city: String,
      state: String,
      pincode: String,
      lat: Number,
      lng: Number,
    },
    contact: {
      phone: String,
      email: String,
      whatsapp: String,
    },
    timing: {
      openTime: { type: String, default: "09:00" },
      closeTime: { type: String, default: "23:00" },
      offDays: [String],
      isOpen: { type: Boolean, default: true },
    },
    deliverySettings: {
      deliveryRadius: { type: Number, default: 5 },
      minOrderAmount: { type: Number, default: 100 },
      deliveryFee: { type: Number, default: 30 },
      freeDeliveryAbove: Number,
      avgDeliveryTime: { type: Number, default: 30 },
      maxDeliveryTime: Number,
    },
    taxSettings: {
      gstNumber: String,
      gstPercentage: { type: Number, default: 5 },
      fssaiLicense: String,
    },
    bankDetails: {
      accountName: String,
      accountNumber: String,
      ifscCode: String,
      bankName: String,
      upiId: String,
    },
    rating: {
      average: { type: Number, default: 0 },
      totalReviews: { type: Number, default: 0 },
    },
    commission: { type: Number, default: 10 },
    isVerified: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    costForTwo: { type: Number, default: 300 },
    offers: [
      {
        code: String,
        description: String,
      },
    ],
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "closed"],
      default: "pending",
    },
    suspensionReason: String,
    onboardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Auto-generate slug before saving
restaurantSchema.pre("save", async function (next) {
  if (!this.isModified("name")) return next();

  let baseSlug = slugify(this.name, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  // Ensure unique slug
  while (await mongoose.model("Restaurant").findOne({ slug, _id: { $ne: this._id } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  this.slug = slug;
  next();
});

// Indexes
restaurantSchema.index({ slug: 1 });
restaurantSchema.index({ status: 1 });
restaurantSchema.index({ cuisines: 1 });
restaurantSchema.index({ "address.city": 1 });
restaurantSchema.index({ isFeatured: 1 });
restaurantSchema.index({ "rating.average": -1 });
restaurantSchema.index({ name: "text", cuisines: "text", description: "text" });

module.exports = mongoose.model("Restaurant", restaurantSchema);
