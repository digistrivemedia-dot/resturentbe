const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// GET /restaurant/notifications — List notifications for the logged-in owner
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

// PUT /restaurant/notifications/:id/read
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

// PUT /restaurant/notifications/read-all
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

module.exports = { getNotifications, markNotificationRead, markAllNotificationsRead };
