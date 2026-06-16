const Order = require("../models/Order");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const ApiResponse = require("../utils/ApiResponse");
const { ORDER_STATUS } = require("../utils/constants");

const getDashboardStats = async (req, res, next) => {
  try {
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

    // This month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Run all queries in parallel
    const [
      todayStats,
      weekStats,
      monthStats,
      totalCustomers,
      totalRestaurants,
      activeRestaurants,
      pendingRestaurants,
      pendingOrders,
      todayOrders,
    ] = await Promise.all([
      // Today's GMV & commission
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: [ORDER_STATUS.CANCELLED] },
          },
        },
        {
          $group: {
            _id: null,
            gmv: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
      ]),
      // Week GMV
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: weekStart, $lte: todayEnd },
            status: { $nin: [ORDER_STATUS.CANCELLED] },
          },
        },
        {
          $group: {
            _id: null,
            gmv: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
      ]),
      // Month GMV
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: monthStart, $lte: todayEnd },
            status: { $nin: [ORDER_STATUS.CANCELLED] },
          },
        },
        {
          $group: {
            _id: null,
            gmv: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
      ]),
      User.countDocuments({ role: "customer", status: "active" }),
      Restaurant.countDocuments(),
      Restaurant.countDocuments({ status: "active" }),
      Restaurant.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: ORDER_STATUS.PLACED }),
      Order.countDocuments({
        createdAt: { $gte: todayStart, $lte: todayEnd },
      }),
    ]);

    const today = todayStats[0] || {};
    const week = weekStats[0] || {};
    const month = monthStats[0] || {};

    // Estimate commission at 10% (can be refined later per-restaurant)
    const commissionRate = 0.1;

    const stats = {
      todayGMV: today.gmv || 0,
      todayOrders: today.orders || 0,
      todayCommission: Math.round((today.gmv || 0) * commissionRate),
      weekGMV: week.gmv || 0,
      weekOrders: week.orders || 0,
      monthGMV: month.gmv || 0,
      monthOrders: month.orders || 0,
      totalCustomers,
      totalRestaurants,
      activeRestaurants,
      pendingApprovals: pendingRestaurants,
      pendingOrders,
      totalOrdersToday: todayOrders,
    };

    return ApiResponse.send(res, 200, "Dashboard stats fetched", { stats });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboardStats };
