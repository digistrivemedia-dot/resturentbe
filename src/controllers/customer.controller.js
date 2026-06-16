const User = require("../models/User");
const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// POST /customer/address — Add address
const addAddress = async (req, res, next) => {
  try {
    const { label, fullAddress, landmark, lat, lng, isDefault } = req.body;
    const user = await User.findById(req.user._id);

    const newAddress = { label, fullAddress, landmark, lat, lng, isDefault };

    // If this is set as default, unset other defaults
    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    // If this is the first address, make it default
    if (user.addresses.length === 0) {
      newAddress.isDefault = true;
    }

    user.addresses.push(newAddress);
    await user.save();

    ApiResponse.send(res, 201, "Address added", {
      addresses: user.addresses,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /customer/address/:id — Update address
const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label, fullAddress, landmark, lat, lng, isDefault } = req.body;
    const user = await User.findById(req.user._id);

    const address = user.addresses.id(id);
    if (!address) {
      throw new ApiError(404, "Address not found");
    }

    if (label) address.label = label;
    if (fullAddress) address.fullAddress = fullAddress;
    if (landmark !== undefined) address.landmark = landmark;
    if (lat !== undefined) address.lat = lat;
    if (lng !== undefined) address.lng = lng;

    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
      address.isDefault = true;
    }

    await user.save();

    ApiResponse.send(res, 200, "Address updated", {
      addresses: user.addresses,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /customer/address/:id — Delete address
const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user._id);

    const address = user.addresses.id(id);
    if (!address) {
      throw new ApiError(404, "Address not found");
    }

    address.deleteOne();
    await user.save();

    ApiResponse.send(res, 200, "Address deleted", {
      addresses: user.addresses,
    });
  } catch (error) {
    next(error);
  }
};

// GET /notifications — List notifications
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments({ user: req.user._id }),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    ApiResponse.send(res, 200, "Notifications fetched", {
      notifications,
      unreadCount,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /notifications/:id/read — Mark as read
const markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      throw new ApiError(404, "Notification not found");
    }

    ApiResponse.send(res, 200, "Notification marked as read", { notification });
  } catch (error) {
    next(error);
  }
};

// PUT /notifications/read-all — Mark all as read
const markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );

    ApiResponse.send(res, 200, "All notifications marked as read");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addAddress,
  updateAddress,
  deleteAddress,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
