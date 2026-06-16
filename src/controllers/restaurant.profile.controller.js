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
      "address",
      "timing",
      "costForTwo",
      "categories",
      "logo",
      "coverImage",
      "images",
    ];

    const restaurant = req.restaurant;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        restaurant[field] = req.body[field];
      }
    }

    // Handle nested contact fields
    if (req.body.phone !== undefined || req.body.email !== undefined) {
      restaurant.contact = restaurant.contact || {};
      if (req.body.phone !== undefined) restaurant.contact.phone = req.body.phone;
      if (req.body.email !== undefined) restaurant.contact.email = req.body.email;
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
