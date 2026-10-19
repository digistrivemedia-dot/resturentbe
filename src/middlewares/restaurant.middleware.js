const ApiError = require("../utils/ApiError");
const Restaurant = require("../models/Restaurant");

const restaurantMiddleware = async (req, res, next) => {
  try {
    // `staff` covers waiter/kitchen POS accounts. Safe to widen here: every
    // route that mounts this middleware pairs it with a role() gate, so adding
    // staff doesn't grant them owner-only routes — role() rejects them first.
    const restaurant = await Restaurant.findOne({
      $or: [{ owner: req.user._id }, { managers: req.user._id }, { staff: req.user._id }],
      status: { $ne: "deleted" },
    });

    if (!restaurant) {
      throw new ApiError(403, "No active restaurant found for this account");
    }

    req.restaurant = restaurant;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    next(new ApiError(500, "Error fetching restaurant"));
  }
};

module.exports = restaurantMiddleware;
