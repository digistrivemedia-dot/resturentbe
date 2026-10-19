const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const STAFF_ROLES = ["waiter", "kitchen"];

// GET /restaurant/staff — waiter + kitchen accounts for this restaurant.
// tempPassword is included deliberately: the owner creates these logins on
// behalf of staff who aren't present, and needs to read the password back to
// hand it over. Same pattern admin.login.controller.js already uses for
// restaurant owners.
const getStaff = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id).select("staff").lean();
    const staff = await User.find({
      _id: { $in: restaurant?.staff || [] },
      status: { $ne: "deleted" },
    })
      .select("name email phone role status lastLogin tempPassword createdAt")
      .sort({ role: 1, name: 1 })
      .lean();

    return ApiResponse.send(res, 200, "Staff fetched", { staff });
  } catch (error) {
    next(error);
  }
};

// POST /restaurant/staff — create a waiter or kitchen login.
const addStaff = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name?.trim()) throw new ApiError(400, "Name is required");
    if (!email?.trim()) throw new ApiError(400, "Email is required");
    if (!password || password.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters");
    }
    if (!STAFF_ROLES.includes(role)) {
      throw new ApiError(400, `Role must be one of: ${STAFF_ROLES.join(", ")}`);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) throw new ApiError(400, "An account with this email already exists");

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || undefined,
      password,
      tempPassword: password, // readable by the owner so they can pass it on
      role,
      authProvider: "email",
      isEmailVerified: true,
    });

    await Restaurant.findByIdAndUpdate(req.restaurant._id, { $addToSet: { staff: user._id } });

    const staff = user.toObject();
    delete staff.password;

    return ApiResponse.send(res, 201, `${role === "waiter" ? "Waiter" : "Kitchen"} account created`, { staff });
  } catch (error) {
    next(error);
  }
};

// PUT /restaurant/staff/:id — rename, change role, reset password, block.
const updateStaff = async (req, res, next) => {
  try {
    const { name, phone, password, role, status } = req.body;

    const restaurant = await Restaurant.findById(req.restaurant._id).select("staff").lean();
    // Scoped to this restaurant's own staff list — an id from another
    // restaurant (or an owner's own user id) must not be editable here.
    const isOwnStaff = (restaurant?.staff || []).some((id) => id.toString() === req.params.id);
    if (!isOwnStaff) throw new ApiError(404, "Staff member not found");

    const user = await User.findById(req.params.id).select("+password");
    if (!user || !STAFF_ROLES.includes(user.role)) throw new ApiError(404, "Staff member not found");

    if (name !== undefined) user.name = name.trim();
    if (phone !== undefined) user.phone = phone?.trim() || undefined;
    if (role !== undefined) {
      if (!STAFF_ROLES.includes(role)) {
        throw new ApiError(400, `Role must be one of: ${STAFF_ROLES.join(", ")}`);
      }
      user.role = role;
    }
    if (status !== undefined) {
      if (!["active", "blocked"].includes(status)) throw new ApiError(400, "Status must be active or blocked");
      user.status = status;
    }
    if (password) {
      if (password.length < 6) throw new ApiError(400, "Password must be at least 6 characters");
      user.password = password; // hashed by the User pre-save hook
      user.tempPassword = password;
      user.passwordResetAt = new Date();
    }

    await user.save();

    const staff = user.toObject();
    delete staff.password;

    return ApiResponse.send(res, 200, "Staff updated", { staff });
  } catch (error) {
    next(error);
  }
};

// DELETE /restaurant/staff/:id — unlink from the restaurant and soft-delete
// the login. Soft, not hard: orders reference placedBy, and a removed waiter
// shouldn't blank out who took last month's orders.
const removeStaff = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id).select("staff").lean();
    const isOwnStaff = (restaurant?.staff || []).some((id) => id.toString() === req.params.id);
    if (!isOwnStaff) throw new ApiError(404, "Staff member not found");

    const running = await Order.countDocuments({ placedBy: req.params.id, bill: null });
    if (running > 0) {
      throw new ApiError(400, "This waiter has unbilled orders on the floor — settle them first");
    }

    await Restaurant.findByIdAndUpdate(req.restaurant._id, { $pull: { staff: req.params.id } });
    await User.findByIdAndUpdate(req.params.id, { status: "deleted" });

    return ApiResponse.send(res, 200, "Staff member removed");
  } catch (error) {
    next(error);
  }
};

module.exports = { getStaff, addStaff, updateStaff, removeStaff };
