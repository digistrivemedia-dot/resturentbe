const Coupon = require("../models/Coupon");
const Order = require("../models/Order");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// GET /coupons — Available coupons for customer
const getAvailableCoupons = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;
    const now = new Date();

    const filter = {
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
      $or: [
        { usageLimit: null },
        { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
      ],
    };

    if (restaurantId) {
      filter.$and = [
        {
          $or: [
            { scope: "platform" },
            { scope: "restaurant", restaurant: restaurantId },
          ],
        },
      ];
    } else {
      filter.scope = "platform";
    }

    const coupons = await Coupon.find(filter)
      .select("-usedCount -createdBy")
      .sort({ createdAt: -1 })
      .lean();

    ApiResponse.send(res, 200, "Coupons fetched", { coupons });
  } catch (error) {
    next(error);
  }
};

// POST /coupons/validate — Validate a coupon against cart
const validateCoupon = async (req, res, next) => {
  try {
    const { code, restaurantId, subtotal } = req.body;

    if (!code) {
      throw new ApiError(400, "Coupon code is required");
    }

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    });

    if (!coupon) {
      throw new ApiError(400, "Invalid or expired coupon code");
    }

    // Check scope
    if (
      coupon.scope === "restaurant" &&
      coupon.restaurant?.toString() !== restaurantId
    ) {
      throw new ApiError(400, "This coupon is not valid for this restaurant");
    }

    // Check min order amount
    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
      throw new ApiError(
        400,
        `Add ₹${coupon.minOrderAmount - subtotal} more to use this coupon`
      );
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new ApiError(400, "Coupon usage limit has been reached");
    }

    // Check per-user limit
    if (coupon.perUserLimit) {
      const userUsage = await Order.countDocuments({
        customer: req.user._id,
        "pricing.couponCode": coupon.code,
        status: { $ne: "cancelled" },
      });
      if (userUsage >= coupon.perUserLimit) {
        throw new ApiError(400, "You have already used this coupon");
      }
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === "percentage") {
      discount = (subtotal * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }

    discount = Math.round(discount * 100) / 100;

    ApiResponse.send(res, 200, "Coupon applied", {
      coupon: {
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount,
        discount,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAvailableCoupons,
  validateCoupon,
};
