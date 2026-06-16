const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS } = require("../utils/constants");

const getDashboardStats = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // This week (Monday to today)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    weekStart.setHours(0, 0, 0, 0);

    // Last week range
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(weekStart);
    lastWeekEnd.setMilliseconds(-1);

    // Today's stats
    const todayStats = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: todayStart, $lte: todayEnd },
          status: { $nin: [ORDER_STATUS.CANCELLED] },
        },
      },
      {
        $group: {
          _id: null,
          todayRevenue: { $sum: "$pricing.total" },
          todayOrders: { $sum: 1 },
          avgOrderValue: { $avg: "$pricing.total" },
        },
      },
    ]);

    // Pending orders count
    const pendingOrders = await Order.countDocuments({
      restaurant: restaurantId,
      status: ORDER_STATUS.PLACED,
    });

    // This week revenue
    const weekStats = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: weekStart, $lte: todayEnd },
          status: { $nin: [ORDER_STATUS.CANCELLED] },
        },
      },
      {
        $group: {
          _id: null,
          weekRevenue: { $sum: "$pricing.total" },
        },
      },
    ]);

    // Last week revenue
    const lastWeekStats = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: lastWeekStart, $lte: lastWeekEnd },
          status: { $nin: [ORDER_STATUS.CANCELLED] },
        },
      },
      {
        $group: {
          _id: null,
          lastWeekRevenue: { $sum: "$pricing.total" },
        },
      },
    ]);

    const today = todayStats[0] || {};
    const week = weekStats[0] || {};
    const lastWeek = lastWeekStats[0] || {};

    const stats = {
      todayRevenue: today.todayRevenue || 0,
      todayOrders: today.todayOrders || 0,
      avgOrderValue: Math.round((today.avgOrderValue || 0) * 100) / 100,
      pendingOrders,
      weekRevenue: week.weekRevenue || 0,
      lastWeekRevenue: lastWeek.lastWeekRevenue || 0,
    };

    return ApiResponse.send(res, 200, "Dashboard stats fetched", { stats });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboardStats };
