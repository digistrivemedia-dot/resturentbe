const Notification = require("../models/Notification");
const User = require("../models/User");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const sendNotification = async (req, res, next) => {
  try {
    const { title, message, type = "system", target, userIds } = req.body;

    if (!title || !message) {
      throw new ApiError(400, "Title and message are required");
    }

    let targetUsers = [];

    if (target === "all_customers") {
      targetUsers = await User.find({ role: "customer", status: "active" }).select("_id").lean();
    } else if (target === "all_restaurants") {
      targetUsers = await User.find({ role: "restaurant_owner", status: "active" }).select("_id").lean();
    } else if (target === "all") {
      targetUsers = await User.find({ status: "active" }).select("_id").lean();
    } else if (target === "specific" && userIds?.length > 0) {
      targetUsers = userIds.map((id) => ({ _id: id }));
    } else {
      throw new ApiError(400, "Invalid target. Use: all, all_customers, all_restaurants, or specific with userIds");
    }

    // Bulk create notifications
    const notifications = targetUsers.map((u) => ({
      user: u._id,
      title,
      message,
      type,
    }));

    await Notification.insertMany(notifications);

    return ApiResponse.send(res, 200, `Notification sent to ${targetUsers.length} users`, {
      sentCount: targetUsers.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/notifications — notifications received by the logged-in super admin
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { user: req.user._id };
    if (status === "unread") filter.isRead = false;
    else if (status === "read") filter.isRead = true;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(filter),
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

// PUT /admin/notifications/:id/read
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

// PUT /admin/notifications/read-all
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

module.exports = { sendNotification, getNotifications, markNotificationRead, markAllNotificationsRead };
