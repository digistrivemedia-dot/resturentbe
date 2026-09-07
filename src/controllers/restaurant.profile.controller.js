const Restaurant = require("../models/Restaurant");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

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

const getPayouts = async (req, res, next) => {
  try {
    // Placeholder for payment phase
    return ApiResponse.send(res, 200, "Payouts fetched", { payouts: [] });
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
