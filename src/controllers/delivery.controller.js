const Restaurant = require("../models/Restaurant");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { checkServiceability } = require("../services/flash.service");

// POST /api/v1/delivery/serviceability
// Called from checkout page to check if Flash can deliver between restaurant and customer
const getServiceability = async (req, res, next) => {
  try {
    const { restaurantId, dropLat, dropLng } = req.body;

    if (!restaurantId || !dropLat || !dropLng) {
      throw new ApiError(400, "restaurantId, dropLat and dropLng are required");
    }

    const restaurant = await Restaurant.findById(restaurantId).lean();
    if (!restaurant) throw new ApiError(404, "Restaurant not found");

    const { lat: pickupLat, lng: pickupLng } = restaurant.address || {};
    if (!pickupLat || !pickupLng) {
      // Restaurant has no coordinates — assume serviceable (fallback)
      return ApiResponse.send(res, 200, "Serviceability checked", {
        serviceable: true,
        deliveryCost: null,
        fallback: true,
      });
    }

    let result;
    try {
      result = await checkServiceability(pickupLat, pickupLng, dropLat, dropLng);
    } catch (flashErr) {
      console.warn("[Delivery] Flash serviceability check failed:", flashErr.message);
      // If Flash API is down, don't block checkout
      return ApiResponse.send(res, 200, "Serviceability checked", {
        serviceable: true,
        deliveryCost: null,
        fallback: true,
      });
    }

    const serviceable =
      result?.serviceability?.riderServiceAble === true &&
      result?.serviceability?.locationServiceAble === true;

    return ApiResponse.send(res, 200, "Serviceability checked", {
      serviceable,
      deliveryCost: serviceable ? result.payouts?.total || null : null,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getServiceability };
