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
    wallet: {
      balance: { type: Number, default: 0 },
      transactions: [
        {
          amount: Number,
          type: { type: String, enum: ["credit", "debit"] },
          description: String,
          date: { type: Date, default: Date.now },
        },
      ],
    },
    status: {
      type: String,
      enum: ["active", "blocked", "deleted"],
      default: "active",
    },
    lastLogin: Date,
    passwordResetAt: Date,  // set when admin manually resets the password
    tempPassword: String,   // plain-text of the last admin-generated password (for admin display only)
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
