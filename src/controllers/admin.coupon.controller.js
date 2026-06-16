const Coupon = require("../models/Coupon");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { COUPON_SCOPE } = require("../utils/constants");

const getCoupons = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, scope } = req.query;

    const query = {};
    if (scope) query.scope = scope;
    if (search) {
      query.$or = [
        { code: new RegExp(search, "i") },
        { title: new RegExp(search, "i") },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [coupons, total] = await Promise.all([
      Coupon.find(query)
        .populate("restaurant", "name")
        .populate("createdBy", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Coupon.countDocuments(query),
    ]);

    return ApiResponse.send(res, 200, "Coupons fetched", {
      coupons,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

const createCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.create({
      ...req.body,
      scope: COUPON_SCOPE.PLATFORM,
      createdBy: req.user._id,
    });

    return ApiResponse.send(res, 201, "Coupon created", { coupon });
  } catch (error) {
    if (error.code === 11000) {
      return next(new ApiError(400, "Coupon code already exists"));
    }
    next(error);
  }
};

const updateCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      throw new ApiError(404, "Coupon not found");
    }

    const allowed = [
      "code", "title", "description", "type", "value", "maxDiscount",
      "minOrderAmount", "usageLimit", "perUserLimit", "validFrom",
      "validUntil", "applicableCuisines", "applicablePaymentMethods", "isActive",
    ];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        coupon[field] = req.body[field];
      }
    });

    await coupon.save();

    return ApiResponse.send(res, 200, "Coupon updated", { coupon });
  } catch (error) {
    next(error);
  }
};

const deleteCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      throw new ApiError(404, "Coupon not found");
    }

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
