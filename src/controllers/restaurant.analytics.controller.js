const mongoose = require("mongoose");
const Order = require("../models/Order");
const MenuItem = require("../models/MenuItem");
const SupportTicket = require("../models/SupportTicket");
const PlatformSettings = require("../models/PlatformSettings");
const ApiResponse = require("../utils/ApiResponse");
const { ORDER_STATUS } = require("../utils/constants");
const { buildOrderMatch, getPreviousPeriod, percentChange } = require("../utils/analyticsFilters");

// ─── Shared helpers ─────────────────────────────────────────────────────────

function pickGranularity(startDate, endDate) {
  if (!startDate || !endDate) return "day";
  const days = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

function dateFormatFor(granularity) {
  if (granularity === "week") return "%G-W%V";
  if (granularity === "month") return "%Y-%m";
  return "%Y-%m-%d";
}

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const round1 = (n) => Math.round((n || 0) * 10) / 10;

// Boundary for "did this customer order before the current period" checks.
// Falling back to the epoch (rather than skipping the condition entirely) when
// no startDate is given matters: without it, an unbounded query's "prior order"
// lookup would match the very orders already counted in the current period —
// making every single-order customer look "returning" against themselves.
function priorOrderCutoff(filters) {
  return filters.startDate ? new Date(filters.startDate) : new Date(0);
}

// GET /restaurant/analytics/overview
const getOverview = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const filters = req.query;
    const match = buildOrderMatch(restaurantId, filters);
    const { prevStart, prevEnd } = getPreviousPeriod(filters.startDate, filters.endDate);
    const prevMatch = prevStart
      ? buildOrderMatch(restaurantId, { ...filters, startDate: prevStart, endDate: prevEnd })
      : null;
    const allStatusMatch = buildOrderMatch(restaurantId, { ...filters, includeCancelled: true });
    const granularity = pickGranularity(filters.startDate, filters.endDate);

    const [currentAgg, previousAgg, cancelAgg, ratingAgg, trend, topItems, bottomItems] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: null, revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 }, aov: { $avg: "$pricing.total" } } },
      ]),
      prevMatch
        ? Order.aggregate([
            { $match: prevMatch },
            { $group: { _id: null, revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      Order.aggregate([
        { $match: allStatusMatch },
        { $group: { _id: null, total: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.CANCELLED] }, 1, 0] } } } },
      ]),
      Order.aggregate([
        { $match: { ...match, "rating.foodRating": { $exists: true, $ne: null } } },
        { $group: { _id: null, avg: { $avg: "$rating.foodRating" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: dateFormatFor(granularity), date: "$createdAt" } },
            revenue: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.menuItem",
            name: { $first: "$items.name" },
            qty: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.itemTotal" },
          },
        },
        { $sort: { qty: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.menuItem",
            name: { $first: "$items.name" },
            qty: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.itemTotal" },
          },
        },
        { $sort: { qty: 1 } },
        { $limit: 5 },
      ]),
    ]);

    const cur = currentAgg[0] || { revenue: 0, orders: 0, aov: 0 };
    const prev = previousAgg[0] || { revenue: 0, orders: 0 };
    const cancel = cancelAgg[0] || { total: 0, cancelled: 0 };
    const rating = ratingAgg[0] || { avg: 0, count: 0 };

    return ApiResponse.send(res, 200, "Overview analytics fetched", {
      kpis: {
        revenue: round2(cur.revenue),
        revenueChangePct: prevMatch ? percentChange(cur.revenue, prev.revenue) : null,
        orders: cur.orders || 0,
        ordersChangePct: prevMatch ? percentChange(cur.orders, prev.orders) : null,
        aov: round2(cur.aov),
        cancellationRatePct: cancel.total > 0 ? round1((cancel.cancelled / cancel.total) * 100) : 0,
        rating: round1(rating.avg),
        ratingCount: rating.count,
      },
      trend: trend.map((t) => ({ bucket: t._id, revenue: round2(t.revenue), orders: t.orders })),
      granularity,
      topItems: topItems.map((i) => ({ menuItem: i._id, name: i.name, qty: i.qty, revenue: round2(i.revenue) })),
      bottomItems: bottomItems.map((i) => ({ menuItem: i._id, name: i.name, qty: i.qty, revenue: round2(i.revenue) })),
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/analytics/sales
const getSales = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const filters = req.query;
    const match = buildOrderMatch(restaurantId, filters);
    const granularity = pickGranularity(filters.startDate, filters.endDate);

    const commissionSetting = await PlatformSettings.findOne({ key: "commission" }).lean();
    const commissionPct = commissionSetting?.value !== undefined ? Number(commissionSetting.value) : 18;

    const [totals, byPaymentMethod, byOrderType, dailyTable, heatmap] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            gross: { $sum: "$pricing.total" },
            subtotal: { $sum: "$pricing.subtotal" },
            deliveryFees: { $sum: "$pricing.deliveryFee" },
            tax: { $sum: "$pricing.taxAmount" },
            couponDiscount: { $sum: "$pricing.couponDiscount" },
            membershipDiscount: { $sum: "$pricing.membershipDiscount" },
            tips: { $sum: "$pricing.tip" },
            platformFees: { $sum: "$pricing.platformFee" },
            orders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$paymentMethod", revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$orderType", revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: dateFormatFor(granularity), date: "$createdAt" } },
            revenue: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Day-of-week x hour-of-day order volume heatmap
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { dow: { $dayOfWeek: "$createdAt" }, hour: { $hour: "$createdAt" } },
            orders: { $sum: 1 },
          },
        },
      ]),
    ]);

    const t = totals[0] || {};
    const gross = round2(t.gross);
    const estimatedNet = round2(gross * (1 - commissionPct / 100));

    return ApiResponse.send(res, 200, "Sales analytics fetched", {
      totals: {
        gross,
        estimatedNet,
        commissionPct,
        subtotal: round2(t.subtotal),
        deliveryFees: round2(t.deliveryFees),
        tax: round2(t.tax),
        discountsGiven: round2((t.couponDiscount || 0) + (t.membershipDiscount || 0)),
        couponDiscount: round2(t.couponDiscount),
        membershipDiscount: round2(t.membershipDiscount),
        tips: round2(t.tips),
        platformFees: round2(t.platformFees),
        orders: t.orders || 0,
        avgDailyRevenue: dailyTable.length > 0 ? round2(gross / dailyTable.length) : 0,
      },
      paymentMethodSplit: byPaymentMethod.map((p) => ({ method: p._id, revenue: round2(p.revenue), orders: p.orders })),
      orderTypeSplit: byOrderType.map((o) => ({ orderType: o._id, revenue: round2(o.revenue), orders: o.orders })),
      dailyTable: dailyTable.map((d) => ({ bucket: d._id, revenue: round2(d.revenue), orders: d.orders })),
      granularity,
      heatmap: heatmap.map((h) => ({ dow: h._id.dow, hour: h._id.hour, orders: h.orders })),
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/analytics/orders
const getOrdersAnalytics = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const filters = req.query;
    const allStatusMatch = buildOrderMatch(restaurantId, { ...filters, includeCancelled: true });

    const [statusBreakdown, timing, cancelReasons, cancelBy, schedule, customerSplit] = await Promise.all([
      Order.aggregate([
        { $match: allStatusMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { ...allStatusMatch, status: ORDER_STATUS.DELIVERED } },
        {
          $addFields: {
            statusMap: {
              $arrayToObject: {
                $map: { input: "$statusHistory", as: "h", in: { k: "$$h.status", v: "$$h.timestamp" } },
              },
            },
          },
        },
        {
          $addFields: {
            prepMinutes: {
              $cond: [
                { $and: ["$statusMap.confirmed", "$statusMap.placed"] },
                { $divide: [{ $subtract: ["$statusMap.confirmed", "$statusMap.placed"] }, 60000] },
                null,
              ],
            },
            fulfillmentMinutes: {
              $cond: [
                "$statusMap.delivered",
                { $divide: [{ $subtract: ["$statusMap.delivered", "$createdAt"] }, 60000] },
                null,
              ],
            },
          },
        },
        { $group: { _id: null, avgPrep: { $avg: "$prepMinutes" }, avgFulfillment: { $avg: "$fulfillmentMinutes" } } },
      ]),
      Order.aggregate([
        { $match: { ...allStatusMatch, status: ORDER_STATUS.CANCELLED } },
        { $group: { _id: "$cancellation.reason", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Order.aggregate([
        { $match: { ...allStatusMatch, status: ORDER_STATUS.CANCELLED } },
        { $group: { _id: "$cancellation.cancelledBy", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: allStatusMatch },
        { $group: { _id: { $cond: ["$scheduledFor", "scheduled", "asap"] }, count: { $sum: 1 } } },
      ]),
      // New vs returning: for each customer with an order in-period, check if
      // they had any earlier (pre-period, non-cancelled) order with this restaurant.
      Order.aggregate([
        { $match: allStatusMatch },
        { $group: { _id: "$customer" } },
        {
          $lookup: {
            from: "orders",
            let: { custId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customer", "$$custId"] },
                      { $eq: ["$restaurant", new mongoose.Types.ObjectId(restaurantId)] },
                      { $ne: ["$status", ORDER_STATUS.CANCELLED] },
                      { $lt: ["$createdAt", priorOrderCutoff(filters)] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "priorOrders",
          },
        },
        { $addFields: { isReturning: { $gt: [{ $size: "$priorOrders" }, 0] } } },
        { $group: { _id: null, newCustomers: { $sum: { $cond: ["$isReturning", 0, 1] } }, returningCustomers: { $sum: { $cond: ["$isReturning", 1, 0] } } } },
      ]),
    ]);

    const timingResult = timing[0] || { avgPrep: null, avgFulfillment: null };
    const custSplit = customerSplit[0] || { newCustomers: 0, returningCustomers: 0 };

    return ApiResponse.send(res, 200, "Order analytics fetched", {
      statusBreakdown: statusBreakdown.map((s) => ({ status: s._id, count: s.count })),
      avgPrepMinutes: timingResult.avgPrep !== null ? round1(timingResult.avgPrep) : null,
      avgFulfillmentMinutes: timingResult.avgFulfillment !== null ? round1(timingResult.avgFulfillment) : null,
      cancellationReasons: cancelReasons.map((c) => ({ reason: c._id || "No reason given", count: c.count })),
      cancelledBy: cancelBy.map((c) => ({ who: c._id, count: c.count })),
      scheduleSplit: schedule.map((s) => ({ type: s._id, count: s.count })),
      newVsReturning: { newCustomers: custSplit.newCustomers, returningCustomers: custSplit.returningCustomers },
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/analytics/items
const getItemsAnalytics = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const filters = req.query;
    const match = buildOrderMatch(restaurantId, filters);
    const itemFilter = { restaurant: new mongoose.Types.ObjectId(restaurantId), status: "active" };
    if (filters.category && filters.category !== "all") itemFilter.category = filters.category;

    const [performance, categoryBreakdown, addonAttach, complaints] = await Promise.all([
      // Every active menu item, left-joined against its sales in the period —
      // this is what surfaces true zero-sale items, not just "low but nonzero".
      MenuItem.aggregate([
        { $match: itemFilter },
        {
          $lookup: {
            from: "orders",
            let: { itemId: "$_id" },
            pipeline: [
              { $match: match },
              { $unwind: "$items" },
              { $match: { $expr: { $eq: ["$items.menuItem", "$$itemId"] } } },
              { $group: { _id: null, qty: { $sum: "$items.quantity" }, revenue: { $sum: "$items.itemTotal" } } },
            ],
            as: "sales",
          },
        },
        {
          $addFields: {
            qty: { $ifNull: [{ $arrayElemAt: ["$sales.qty", 0] }, 0] },
            revenue: { $ifNull: [{ $arrayElemAt: ["$sales.revenue", 0] }, 0] },
          },
        },
        { $project: { name: 1, category: 1, price: 1, discountedPrice: 1, image: 1, description: 1, isVeg: 1, isAvailable: 1, isBestseller: 1, qty: 1, revenue: 1 } },
        { $sort: { qty: -1 } },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "menuitems",
            localField: "items.menuItem",
            foreignField: "_id",
            as: "menuItemDoc",
          },
        },
        {
          $group: {
            _id: { $ifNull: [{ $arrayElemAt: ["$menuItemDoc.category", 0] }, "Uncategorized"] },
            revenue: { $sum: "$items.itemTotal" },
            qty: { $sum: "$items.quantity" },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        { $unwind: "$items.addons" },
        { $group: { _id: "$items.addons.name", qty: { $sum: 1 }, revenue: { $sum: "$items.addons.price" } } },
        { $sort: { qty: -1 } },
        { $limit: 10 },
      ]),
      SupportTicket.aggregate([
        {
          $match: {
            restaurant: new mongoose.Types.ObjectId(restaurantId),
            ...(filters.startDate || filters.endDate
              ? {
                  createdAt: {
                    ...(filters.startDate ? { $gte: new Date(filters.startDate) } : {}),
                    ...(filters.endDate ? { $lte: new Date(filters.endDate) } : {}),
                  },
                }
              : {}),
          },
        },
        { $unwind: "$affectedItems" },
        { $group: { _id: "$affectedItems.menuItem", complaints: { $sum: 1 } } },
      ]),
    ]);

    const complaintMap = new Map(complaints.map((c) => [String(c._id), c.complaints]));
    const performanceWithComplaints = performance.map((item) => {
      const complaintCount = complaintMap.get(String(item._id)) || 0;
      return {
        menuItem: item._id,
        name: item.name,
        category: item.category,
        price: item.price,
        discountedPrice: item.discountedPrice,
        image: item.image,
        description: item.description,
        isVeg: item.isVeg,
        isAvailable: item.isAvailable,
        isBestseller: item.isBestseller,
        qty: item.qty,
        revenue: round2(item.revenue),
        complaints: complaintCount,
        complaintRatePct: item.qty > 0 ? round1((complaintCount / item.qty) * 100) : null,
      };
    });

    const topSellers = [...performanceWithComplaints].sort((a, b) => b.qty - a.qty).slice(0, 15);
    const bottomSellers = [...performanceWithComplaints].sort((a, b) => a.qty - b.qty).slice(0, 15);
    const topByRevenue = [...performanceWithComplaints].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
    const mostComplained = [...performanceWithComplaints]
      .filter((i) => i.complaints > 0)
      .sort((a, b) => b.complaints - a.complaints)
      .slice(0, 10);

    return ApiResponse.send(res, 200, "Item analytics fetched", {
      allItems: performanceWithComplaints,
      topSellers,
      bottomSellers,
      topByRevenue,
      mostComplained,
      categoryBreakdown: categoryBreakdown.map((c) => ({ category: c._id, revenue: round2(c.revenue), qty: c.qty })),
      addonAttachRate: addonAttach.map((a) => ({ addon: a._id, qty: a.qty, revenue: round2(a.revenue) })),
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/analytics/customers
const getCustomersAnalytics = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const filters = req.query;
    const match = buildOrderMatch(restaurantId, filters);

    const [perCustomer, topCustomers, allTimeRepeat] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$customer", orders: { $sum: 1 }, spend: { $sum: "$pricing.total" } } },
        {
          $lookup: {
            from: "orders",
            let: { custId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customer", "$$custId"] },
                      { $eq: ["$restaurant", new mongoose.Types.ObjectId(restaurantId)] },
                      { $ne: ["$status", ORDER_STATUS.CANCELLED] },
                      { $lt: ["$createdAt", priorOrderCutoff(filters)] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "priorOrders",
          },
        },
        { $addFields: { isReturning: { $gt: [{ $size: "$priorOrders" }, 0] } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$customer", orders: { $sum: 1 }, spend: { $sum: "$pricing.total" } } },
        { $sort: { spend: -1 } },
        { $limit: 10 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "customer" } },
        { $unwind: "$customer" },
        { $project: { name: "$customer.name", phone: "$customer.phone", orders: 1, spend: 1 } },
      ]),
      // All-time repeat rate for this restaurant (not period-scoped) — a more
      // stable long-run retention signal than a single filtered window.
      Order.aggregate([
        { $match: { restaurant: new mongoose.Types.ObjectId(restaurantId), status: { $ne: ORDER_STATUS.CANCELLED } } },
        { $group: { _id: "$customer", orders: { $sum: 1 } } },
        { $group: { _id: null, totalCustomers: { $sum: 1 }, repeatCustomers: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } } } },
      ]),
    ]);

    const newCustomers = perCustomer.filter((c) => !c.isReturning).length;
    const returningCustomers = perCustomer.filter((c) => c.isReturning).length;
    const totalOrders = perCustomer.reduce((sum, c) => sum + c.orders, 0);
    const repeat = allTimeRepeat[0] || { totalCustomers: 0, repeatCustomers: 0 };

    return ApiResponse.send(res, 200, "Customer analytics fetched", {
      newCustomers,
      returningCustomers,
      totalCustomers: perCustomer.length,
      avgOrdersPerCustomer: perCustomer.length > 0 ? round1(totalOrders / perCustomer.length) : 0,
      allTimeRepeatRatePct: repeat.totalCustomers > 0 ? round1((repeat.repeatCustomers / repeat.totalCustomers) * 100) : 0,
      topCustomers: topCustomers.map((c) => ({ name: c.name, phone: c.phone, orders: c.orders, spend: round2(c.spend) })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getOverview, getSales, getOrdersAnalytics, getItemsAnalytics, getCustomersAnalytics };
