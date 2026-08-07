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

module.exports = { getPlatformFee };
