const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    enum: ["home", "work", "other"],
    default: "home",
  },
  fullAddress: String,
  landmark: String,
  pincode: String,
  lat: Number,
  lng: Number,
  isDefault: { type: Boolean, default: false },
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      select: false,
    },
    avatar: String,
    role: {
      type: String,
      enum: ["customer", "restaurant_owner", "super_admin"],
      default: "customer",
    },
    authProvider: {
      type: String,
      enum: ["google", "phone", "email"],
      default: "email",
    },
    googleId: String,
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    addresses: [addressSchema],
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" }],
    favoriteDishes: [{ type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" }],
    status: {
      type: String,
      enum: ["active", "blocked", "deleted"],
      default: "active",
    },
    lastLogin: Date,
    passwordResetAt: Date,  // set when admin manually resets the password
    tempPassword: String,   // plain-text of the last admin-generated password (for admin display only)
    membership: {
      expiresAt: Date, // "is member" = expiresAt > now, checked lazily wherever needed (no cron)
      startedAt: Date, // when the current active period began
      lastPurchase: {
        razorpayOrderId: String,
        razorpayPaymentId: String,
        amount: Number,
        purchasedAt: Date,
      },
    },
    // Counts toward the "first 4 orders get 50% off" new-customer promo — incremented
    // only when an order is actually confirmed (not on abandoned/pending-payment orders),
    // so a failed checkout doesn't burn the customer's discount eligibility.
    newCustomerOrdersUsed: { type: Number, default: 0 },
    // Set when a super admin or restaurant owner sends this customer the
    // membership popup — the customer's app shows it once (live via socket if
    // they're online, otherwise on next app open) and clears this back to null.
    membershipPopupRequestedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Unique sparse indexes (sparse = allow multiple nulls)
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

// Hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
