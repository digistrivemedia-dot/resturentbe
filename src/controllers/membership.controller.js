const User = require("../models/User");
const PlatformSettings = require("../models/PlatformSettings");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { createRazorpayOrder, verifyPaymentSignature } = require("../services/razorpay.service");

const DEFAULTS = {
  membershipPrice: 299,
  membershipDiscountPercent: 20,
  membershipDurationDays: 30,
};

// Reads membership pricing from PlatformSettings (admin-configurable), falling back to defaults
async function getMembershipSettings() {
  const docs = await PlatformSettings.find({ key: { $in: Object.keys(DEFAULTS) } }).lean();
  const map = {};
  docs.forEach((d) => { map[d.key] = d.value; });
  return {
    price: Number(map.membershipPrice ?? DEFAULTS.membershipPrice),
    discountPercent: Number(map.membershipDiscountPercent ?? DEFAULTS.membershipDiscountPercent),
    durationDays: Number(map.membershipDurationDays ?? DEFAULTS.membershipDurationDays),
  };
}

function getMembershipStatusFromUser(user) {
  const membership = user.membership;
  const now = new Date();
  const isActive = !!(membership?.expiresAt && new Date(membership.expiresAt) > now);
  const daysLeft = isActive ? Math.ceil((new Date(membership.expiresAt) - now) / (24 * 60 * 60 * 1000)) : 0;
  return {
    isActive,
    daysLeft,
    expiresAt: membership?.expiresAt || null,
    startedAt: membership?.startedAt || null,
  };
}

// GET /customer/membership — current membership status + pricing
const getMembershipStatus = async (req, res, next) => {
  try {
    const settings = await getMembershipSettings();
    ApiResponse.send(res, 200, "Membership status", {
      ...getMembershipStatusFromUser(req.user),
      ...settings,
    });
  } catch (error) {
    next(error);
  }
};

// POST /customer/membership/checkout — create Razorpay order to buy/renew membership
const createMembershipOrder = async (req, res, next) => {
  try {
    const { price } = await getMembershipSettings();
    // Razorpay caps "receipt" at 40 chars — base36 timestamp keeps this well under that
    // even with a full 24-char Mongo ObjectId (MEM- + 24 + - + ~8 = ~37 chars)
    const receipt = `MEM-${req.user._id}-${Date.now().toString(36)}`;
    const rzpOrder = await createRazorpayOrder(price, receipt, {
      type: "membership",
      userId: String(req.user._id),
    });

    ApiResponse.send(res, 200, "Membership order created", {
      razorpay: {
        orderId: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
      price,
    });
  } catch (error) {
    next(error);
  }
};

// POST /customer/membership/verify — verify payment, activate/extend membership
const verifyMembershipPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new ApiError(400, "Missing payment verification details");
    }

    const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      throw new ApiError(400, "Payment verification failed");
    }

    const { price, durationDays } = await getMembershipSettings();
    const user = await User.findById(req.user._id);

    const now = new Date();
    const wasActive = user.membership?.expiresAt && new Date(user.membership.expiresAt) > now;
    // Renewing early extends from the current expiry instead of resetting to today
    const base = wasActive ? new Date(user.membership.expiresAt) : now;
    const newExpiresAt = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);

    user.membership = {
      expiresAt: newExpiresAt,
      startedAt: wasActive ? user.membership.startedAt : now,
      lastPurchase: {
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        amount: price,
        purchasedAt: now,
      },
    };
    await user.save();

    ApiResponse.send(res, 200, "Membership activated", {
      ...getMembershipStatusFromUser(user),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMembershipStatus, createMembershipOrder, verifyMembershipPayment };
