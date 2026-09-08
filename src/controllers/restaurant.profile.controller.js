const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const PlatformSettings = require("../models/PlatformSettings");
const ApiResponse = require("../utils/ApiResponse");
const { ORDER_STATUS } = require("../utils/constants");

const getProfile = async (req, res, next) => {
  try {
    return ApiResponse.send(res, 200, "Restaurant profile fetched", {
      restaurant: req.restaurant,
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      "name",
      "description",
      "cuisines",
      "timing",
      "weeklyHours",
      "costForTwo",
      "categories",
      "logo",
      "coverImage",
      "bannerImage",
      "bannerVideo",
      "images",
    ];

    const restaurant = req.restaurant;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        restaurant[field] = req.body[field];
      }
    }

    // address/contact are nested subdocuments — merge onto the existing values
    // instead of overwriting, so a partial update (e.g. just phone) doesn't
    // wipe fields the caller didn't send.
    if (req.body.address !== undefined) {
      const existing = restaurant.address?.toObject?.() || restaurant.address || {};
      restaurant.address = { ...existing, ...req.body.address };
    }
    if (req.body.contact !== undefined) {
      const existing = restaurant.contact?.toObject?.() || restaurant.contact || {};
      restaurant.contact = { ...existing, ...req.body.contact };
    }

    await restaurant.save();

    return ApiResponse.send(res, 200, "Profile updated", { restaurant });
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const restaurant = req.restaurant;
    const { deliverySettings } = req.body;

    if (deliverySettings) {
      const existing = restaurant.deliverySettings
        ? restaurant.deliverySettings.toObject()
        : {};
      restaurant.deliverySettings = {
        ...existing,
        ...deliverySettings,
      };
    }

    await restaurant.save();

    return ApiResponse.send(res, 200, "Settings updated", { restaurant });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/payouts — Every order transaction for this restaurant, with
// the platform commission and net amount computed per order. This is a
// transaction ledger (so the restaurant/admin can see all business done),
// not a real payout-batch system — there's no actual bank-transfer tracking
// behind it, so "status" reflects the order's real status, not a money-moved
// state.
const getPayouts = async (req, res, next) => {
  try {
    const commissionSetting = await PlatformSettings.findOne({ key: "commission" }).lean();
    const commissionPct = commissionSetting?.value !== undefined ? Number(commissionSetting.value) : 18;

    const orders = await Order.find({ restaurant: req.restaurant._id })
      .sort({ createdAt: -1 })
      .select("orderNumber createdAt status paymentStatus pricing")
      .lean();

    const payouts = orders.map((o) => {
      const gross = o.pricing?.total || 0;
      const subtotal = o.pricing?.subtotal || 0;
      const isCancelled = o.status === ORDER_STATUS.CANCELLED;

      // Commission only applies to business that actually happened — a
      // cancelled order never earned the platform (or the restaurant) anything.
      const fee = isCancelled ? 0 : Math.round(subtotal * (commissionPct / 100) * 100) / 100;
      const net = isCancelled ? 0 : Math.round((gross - fee) * 100) / 100;

      return {
        _id: o._id,
        payoutId: o.orderNumber,
        period: o.createdAt,
        gross,
        fee,
        net,
        commissionPct,
        status: o.status,
        paymentStatus: o.paymentStatus,
      };
    });

    return ApiResponse.send(res, 200, "Payouts fetched", { payouts });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateSettings,
  getPayouts,
};
