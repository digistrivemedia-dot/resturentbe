const PlatformSettings = require("../models/PlatformSettings");
const ApiResponse = require("../utils/ApiResponse");

// GET /public/settings/platform-fee
const getPlatformFee = async (req, res, next) => {
  try {
    const docs = await PlatformSettings.find({
      key: { $in: ["platformFeeEnabled", "platformFeeAmount"] },
    }).lean();

    const map = {};
    docs.forEach((d) => {
      map[d.key] = d.value;
    });

    const enabled = map.platformFeeEnabled !== undefined ? !!map.platformFeeEnabled : true;
    const amount = map.platformFeeAmount !== undefined ? Number(map.platformFeeAmount) : 3;

    return ApiResponse.send(res, 200, "Platform fee fetched", { enabled, amount });
  } catch (error) {
    next(error);
  }
};

const DEFAULT_ORDER_TYPES_ENABLED = { delivery: true, pickup: true, dine_in: true, self_service: true };

// GET /public/settings/order-types
const getOrderTypes = async (req, res, next) => {
  try {
    const doc = await PlatformSettings.findOne({ key: "orderTypesEnabled" }).lean();
    const orderTypes = { ...DEFAULT_ORDER_TYPES_ENABLED, ...(doc?.value || {}) };

    return ApiResponse.send(res, 200, "Order types fetched", orderTypes);
  } catch (error) {
    next(error);
  }
};

module.exports = { getPlatformFee, getOrderTypes };
