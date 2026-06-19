const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const jwt = require("jsonwebtoken");

// GET /admin/restaurants/:id/logins
const getRestaurantLogins = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate("owner", "name email phone createdAt")
      .populate("managers", "name email phone createdAt");

    if (!restaurant) throw new ApiError(404, "Restaurant not found");

    const ownerPhone = restaurant.owner?.phone || "";
    const ownerInitialPassword = ownerPhone
      ? ownerPhone.slice(-4) + "@Cafe"
      : "Auto-generated (use Reset)";

    const logins = [
      {
        _id: restaurant.owner?._id,
        name: restaurant.owner?.name,
        email: restaurant.owner?.email,
        phone: restaurant.owner?.phone,
        isOwner: true,
        initialPassword: ownerInitialPassword,
        createdAt: restaurant.owner?.createdAt,
      },
      ...(restaurant.managers || []).map((m) => ({
        _id: m._id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        isOwner: false,
        initialPassword: m.phone ? m.phone.slice(-4) + "@Cafe" : "Auto-generated (use Reset)",
        createdAt: m.createdAt,
      })),
    ];

    return ApiResponse.send(res, 200, "Logins fetched", { logins });
  } catch (error) {
    next(error);
  }
};

// POST /admin/restaurants/:id/logins
const addRestaurantLogin = async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email) throw new ApiError(400, "Name and email are required");

    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) throw new ApiError(404, "Restaurant not found");

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError(400, "A user with this email already exists");

    const tempPassword = phone
      ? phone.slice(-4) + "@Cafe"
      : Math.random().toString(36).slice(-8) + "@Cafe";

    const user = await User.create({
      name,
      email,
      phone: phone || undefined,
      password: tempPassword,
      role: "restaurant_owner",
      authProvider: "email",
      isEmailVerified: true,
    });

    if (!restaurant.managers) restaurant.managers = [];
    restaurant.managers.push(user._id);
    await restaurant.save();

    return ApiResponse.send(res, 201, "Login created successfully", {
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone },
      tempPassword,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /admin/restaurants/:id/logins/:userId/reset-password
const resetLoginPassword = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Generate new password
    const newPassword = Math.random().toString(36).slice(-6).toUpperCase() + "@Cafe";
    user.password = newPassword;
    await user.save();

    return ApiResponse.send(res, 200, "Password reset successfully", { newPassword });
  } catch (error) {
    next(error);
  }
};

// GET /admin/restaurants/:id/logins/:userId/impersonate-token
const getImpersonateToken = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) throw new ApiError(404, "User not found");

    const impersonateToken = jwt.sign(
      { userId: user._id, impersonate: true },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );

    return ApiResponse.send(res, 200, "Impersonate token generated", { impersonateToken });
  } catch (error) {
    next(error);
  }
};

module.exports = { getRestaurantLogins, addRestaurantLogin, resetLoginPassword, getImpersonateToken };
