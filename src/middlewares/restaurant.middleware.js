const ApiError = require("../utils/ApiError");
const Restaurant = require("../models/Restaurant");

const restaurantMiddleware = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findOne({ owner: req.user._id });

    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found for this user");
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
