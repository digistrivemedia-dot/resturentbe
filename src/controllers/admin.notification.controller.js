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

module.exports = { sendNotification };
