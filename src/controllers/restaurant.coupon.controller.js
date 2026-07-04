const Coupon = require("../models/Coupon");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { COUPON_SCOPE } = require("../utils/constants");

const getCoupons = async (req, res, next) => {
  try {
    const coupons = await Coupon.find({
      restaurant: req.restaurant._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    return ApiResponse.send(res, 200, "Coupons fetched", { coupons });
  } catch (error) {
    next(error);
  }
};

const createCoupon = async (req, res, next) => {
  try {
    const {
      code,
      title,
      description,
      type,
      value,
      maxDiscount,
      minOrderAmount,
      usageLimit,
      perUserLimit,
      validFrom,
      validUntil,
      applicableItems,
      applicableCuisines,
      applicablePaymentMethods,
    } = req.body;

    // Check if code already exists
    const existing = await Coupon.findOne({ code: code.toUpperCase() }).lean();
    if (existing) {
      throw new ApiError(400, "Coupon code already exists");
    }

    const coupon = await Coupon.create({
      code,
      title,
      description,
      type,
      value: type === "free_delivery" ? 0 : value,
      maxDiscount,
      minOrderAmount,
      restaurant: req.restaurant._id,
      scope: COUPON_SCOPE.RESTAURANT,
      usageLimit,
      perUserLimit,
      validFrom,
      validUntil,
      applicableItems: applicableItems || [],
      applicableCuisines,
      applicablePaymentMethods,
      createdBy: req.user._id,
    });

    return ApiResponse.send(res, 201, "Coupon created", { coupon });
  } catch (error) {
    next(error);
  }
};

const updateCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!coupon) {
      throw new ApiError(404, "Coupon not found");
    }

    const allowedFields = [
      "title",
      "description",
      "type",
      "value",
      "maxDiscount",
      "minOrderAmount",
      "usageLimit",
      "perUserLimit",
      "validFrom",
      "validUntil",
      "applicableItems",
      "applicableCuisines",
      "applicablePaymentMethods",
      "isActive",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        coupon[field] = req.body[field];
      }
    }

    await coupon.save();

    return ApiResponse.send(res, 200, "Coupon updated", { coupon });
  } catch (error) {
    next(error);
  }
};

const deleteCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!coupon) {
      throw new ApiError(404, "Coupon not found");
    }

    await Coupon.deleteOne({ _id: coupon._id });

    return ApiResponse.send(res, 200, "Coupon deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
};
