const mongoose = require("mongoose");
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const User = require("../models/User");
const SupportTicket = require("../models/SupportTicket");
const PlatformSettings = require("../models/PlatformSettings");
const ApiResponse = require("../utils/ApiResponse");
const { ORDER_STATUS } = require("../utils/constants");
const { buildPlatformOrderMatch, getPreviousPeriod, percentChange, dateRangeMatch } = require("../utils/analyticsFilters");

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const round1 = (n) => Math.round((n || 0) * 10) / 10;

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

// Same epoch-fallback fix as the restaurant analytics controller — without it,
// an unbounded query's "prior order" lookup would match orders already counted
// in the current period, making every single-order customer look "returning".
function priorOrderCutoff(filters) {
  return filters.startDate ? new Date(filters.startDate) : new Date(0);
}

// Drops anything that isn't a valid id instead of throwing. Callers pass
// values that can originate in a query string, and an invalid id used to
// surface as a 500 across every endpoint.
function toObjectIds(ids) {
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
}

// City / single-restaurant filters aren't fields on Order — resolve them to a
// restaurant id list upstream so every query can filter Order.restaurant directly.
// Scoped to approved (active) restaurants only — pending/suspended restaurants
// don't appear anywhere in platform analytics.
async function resolveRestaurantIds(filters) {
  if (filters.restaurantId && filters.restaurantId !== "all") {
    // A malformed id used to reach toObjectIds and throw "input must be a 24
    // character hex string", 500-ing all seven endpoints. The UI only ever
    // sends ids from its own dropdown, but a hand-edited query string
    // shouldn't produce a server error. An empty list scopes the query to no
    // restaurants, so the caller gets honest zeroes.
    if (!mongoose.Types.ObjectId.isValid(filters.restaurantId)) return [];
    return [filters.restaurantId];
  }
  if (filters.city && filters.city !== "all") {
    const restaurants = await Restaurant.find({ "address.city": filters.city, status: "active" }).select("_id").lean();
    return restaurants.map((r) => r._id);
  }
  return null;
}

// Commission is charged on food subtotal (not delivery fee/tax/tip, which pass
// through to riders/government/riders respectively) — this is an estimate using
// the platform's CURRENT commission rate, same caveat as the restaurant version.
async function getCommissionPct() {
  const setting = await PlatformSettings.findOne({ key: "commission" }).lean();
  return setting?.value !== undefined ? Number(setting.value) : 18;
}

// GET /admin/analytics/filter-options
const getFilterOptions = async (req, res, next) => {
  try {
    const [cities, restaurants] = await Promise.all([
      Restaurant.distinct("address.city", { status: "active" }),
      Restaurant.find({ status: "active" }).select("name address.city").sort({ name: 1 }).lean(),
    ]);
    return ApiResponse.send(res, 200, "Filter options fetched", {
      cities: cities.filter(Boolean).sort(),
      restaurants: restaurants.map((r) => ({ id: r._id, name: r.name, city: r.address?.city })),
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/overview
const getOverview = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch(filters, restaurantIds);
    const { prevStart, prevEnd } = getPreviousPeriod(filters.startDate, filters.endDate);
    const prevMatch = prevStart
      ? buildPlatformOrderMatch({ ...filters, startDate: prevStart, endDate: prevEnd }, restaurantIds)
      : null;
    const allStatusMatch = buildPlatformOrderMatch({ ...filters, includeCancelled: true }, restaurantIds);
    const granularity = pickGranularity(filters.startDate, filters.endDate);
    const commissionPct = await getCommissionPct();

    const restaurantScope = restaurantIds ? { _id: { $in: toObjectIds(restaurantIds) } } : {};
    // Shared with the newRestaurants count below. Returns null when neither
    // bound is a usable date, so the key is omitted rather than sent as {} —
    // which Mongoose rejects with "Cast to date failed", 500-ing the endpoint
    // and (because every section is gated on these KPIs) blanking the page.
    const newRestaurantRange = dateRangeMatch(filters.startDate, filters.endDate);

    const [currentAgg, previousAgg, cancelAgg, ratingAgg, trend, activeRestaurants, newRestaurants] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            gmv: { $sum: "$pricing.total" },
            subtotal: { $sum: "$pricing.subtotal" },
            platformFees: { $sum: "$pricing.platformFee" },
            orders: { $sum: 1 },
            aov: { $avg: "$pricing.total" },
          },
        },
      ]),
      prevMatch
        ? Order.aggregate([
            { $match: prevMatch },
            { $group: { _id: null, gmv: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      Order.aggregate([
        { $match: allStatusMatch },
        { $group: { _id: null, total: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ["$status", ORDER_STATUS.CANCELLED] }, 1, 0] } } } },
      ]),
      // Order.rating has no "foodRating" field — it never has. Ratings live in
      // rating.itemRatings[].rating (one per dish) and rating.deliveryRating.
      // Querying the non-existent field matched nothing, so this KPI always
      // read "No ratings yet" even with rated orders in the period.
      // Each order is averaged across its own dishes first, then across
      // orders, so a 10-dish order doesn't outweigh a 1-dish one.
      Order.aggregate([
        { $match: { ...match, "rating.itemRatings.0": { $exists: true } } },
        { $addFields: { orderRating: { $avg: "$rating.itemRatings.rating" } } },
        { $group: { _id: null, avg: { $avg: "$orderRating" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: dateFormatFor(granularity), date: "$createdAt" } },
            gmv: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Restaurant.countDocuments({ ...restaurantScope, status: "active" }),
      // An empty createdAt range ({}) makes Mongoose throw "Cast to date
      // failed for value {}", 500-ing the whole endpoint — and because the
      // page gates every section on these KPIs, the entire analytics screen
      // renders blank. The UI always sends both dates, but the endpoint must
      // not depend on that.
      Restaurant.countDocuments({
        ...restaurantScope,
        status: "active",
        ...(newRestaurantRange ? { createdAt: newRestaurantRange } : {}),
      }),
    ]);

    const cur = currentAgg[0] || { gmv: 0, subtotal: 0, platformFees: 0, orders: 0, aov: 0 };
    const prev = previousAgg[0] || { gmv: 0, orders: 0 };
    const cancel = cancelAgg[0] || { total: 0, cancelled: 0 };
    const rating = ratingAgg[0] || { avg: 0, count: 0 };
    const commissionEarned = (cur.subtotal || 0) * (commissionPct / 100);
    const platformRevenue = commissionEarned + (cur.platformFees || 0);

    return ApiResponse.send(res, 200, "Overview analytics fetched", {
      kpis: {
        gmv: round2(cur.gmv),
        gmvChangePct: prevMatch ? percentChange(cur.gmv, prev.gmv) : null,
        orders: cur.orders || 0,
        ordersChangePct: prevMatch ? percentChange(cur.orders, prev.orders) : null,
        aov: round2(cur.aov),
        platformRevenue: round2(platformRevenue),
        commissionEarned: round2(commissionEarned),
        platformFeesCollected: round2(cur.platformFees),
        commissionPct,
        cancellationRatePct: cancel.total > 0 ? round1((cancel.cancelled / cancel.total) * 100) : 0,
        rating: round1(rating.avg),
        ratingCount: rating.count,
        activeRestaurants,
        newRestaurants,
      },
      trend: trend.map((t) => ({ bucket: t._id, gmv: round2(t.gmv), orders: t.orders })),
      granularity,
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/cities
const getCities = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch(filters, restaurantIds);

    const [orderStats, restaurantCounts] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $lookup: { from: "restaurants", localField: "restaurant", foreignField: "_id", as: "r" } },
        { $unwind: "$r" },
        {
          $group: {
            _id: { $ifNull: ["$r.address.city", "Unknown"] },
            gmv: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
            customers: { $addToSet: "$customer" },
          },
        },
      ]),
      Restaurant.aggregate([
        { $match: { status: "active", ...(restaurantIds ? { _id: { $in: toObjectIds(restaurantIds) } } : {}) } },
        { $group: { _id: { $ifNull: ["$address.city", "Unknown"] }, count: { $sum: 1 } } },
      ]),
    ]);

    const restaurantCountMap = new Map(restaurantCounts.map((r) => [r._id, r.count]));
    const totalGmv = orderStats.reduce((s, c) => s + c.gmv, 0);

    const cities = orderStats
      .map((c) => ({
        city: c._id,
        gmv: round2(c.gmv),
        orders: c.orders,
        customers: c.customers.length,
        restaurants: restaurantCountMap.get(c._id) || 0,
        sharePct: totalGmv > 0 ? round1((c.gmv / totalGmv) * 100) : 0,
      }))
      .sort((a, b) => b.gmv - a.gmv);

    return ApiResponse.send(res, 200, "City breakdown fetched", { cities });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/restaurants
const getRestaurantsLeaderboard = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch(filters, null); // restaurant scoping applied via the outer Restaurant $match below

    const restaurantFilter = {
      status: "active",
      ...(restaurantIds ? { _id: { $in: toObjectIds(restaurantIds) } } : {}),
    };

    const leaderboard = await Restaurant.aggregate([
      { $match: restaurantFilter },
      {
        $lookup: {
          from: "orders",
          let: { rid: "$_id" },
          pipeline: [
            { $match: match },
            { $match: { $expr: { $eq: ["$restaurant", "$$rid"] } } },
            { $group: { _id: null, gmv: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
          ],
          as: "stats",
        },
      },
      {
        $addFields: {
          gmv: { $ifNull: [{ $arrayElemAt: ["$stats.gmv", 0] }, 0] },
          orders: { $ifNull: [{ $arrayElemAt: ["$stats.orders", 0] }, 0] },
        },
      },
      { $project: { name: 1, slug: 1, city: "$address.city", status: 1, rating: "$rating.average", reviewCount: "$rating.totalReviews", gmv: 1, orders: 1 } },
    ]);

    const restaurants = leaderboard
      .map((r) => ({
        restaurantId: r._id,
        name: r.name,
        slug: r.slug,
        city: r.city,
        status: r.status,
        rating: r.rating || 0,
        reviewCount: r.reviewCount || 0,
        gmv: round2(r.gmv),
        orders: r.orders,
      }))
      .sort((a, b) => b.gmv - a.gmv);

    return ApiResponse.send(res, 200, "Restaurant leaderboard fetched", { restaurants });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/customers
const getCustomersAnalytics = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch(filters, restaurantIds);

    const [perCustomer, membershipAgg, retentionAllTime, membershipRevenueAgg] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$customer", orders: { $sum: 1 } } },
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
                      { $ne: ["$status", ORDER_STATUS.CANCELLED] },
                      { $lt: ["$createdAt", priorOrderCutoff(filters)] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "prior",
          },
        },
        { $addFields: { isReturning: { $gt: [{ $size: "$prior" }, 0] } } },
      ]),
      User.aggregate([
        { $match: { role: "customer" } },
        { $group: { _id: null, activeMembers: { $sum: { $cond: [{ $gt: ["$membership.expiresAt", new Date()] }, 1, 0] } } } },
      ]),
      // All-time repeat rate isn't affected by the date filter — a stabler retention signal
      Order.aggregate([
        { $match: { status: { $ne: ORDER_STATUS.CANCELLED } } },
        { $group: { _id: "$customer", orders: { $sum: 1 } } },
        { $group: { _id: null, total: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } } } },
      ]),
      // Membership revenue this period — approximated from lastPurchase since only the
      // most recent purchase is tracked per user, not a full purchase history
      User.aggregate([
        {
          $match: {
            "membership.lastPurchase.purchasedAt": {
              ...(filters.startDate ? { $gte: new Date(filters.startDate) } : {}),
              ...(filters.endDate ? { $lte: new Date(filters.endDate) } : {}),
            },
          },
        },
        { $group: { _id: null, revenue: { $sum: "$membership.lastPurchase.amount" }, count: { $sum: 1 } } },
      ]),
    ]);

    const newCustomers = perCustomer.filter((c) => !c.isReturning).length;
    const returningCustomers = perCustomer.filter((c) => c.isReturning).length;
    const totalOrders = perCustomer.reduce((s, c) => s + c.orders, 0);
    const retention = retentionAllTime[0] || { total: 0, repeat: 0 };
    const membership = membershipAgg[0] || { activeMembers: 0 };
    const membershipRevenue = membershipRevenueAgg[0] || { revenue: 0, count: 0 };

    return ApiResponse.send(res, 200, "Customer analytics fetched", {
      newCustomers,
      returningCustomers,
      totalCustomers: perCustomer.length,
      avgOrdersPerCustomer: perCustomer.length > 0 ? round1(totalOrders / perCustomer.length) : 0,
      allTimeRepeatRatePct: retention.total > 0 ? round1((retention.repeat / retention.total) * 100) : 0,
      activeMembers: membership.activeMembers,
      membershipRevenueThisPeriod: round2(membershipRevenue.revenue),
      newMembershipsThisPeriod: membershipRevenue.count,
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/order-mix
const getOrderMix = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch(filters, restaurantIds);

    const [byType, byPayment] = await Promise.all([
      Order.aggregate([{ $match: match }, { $group: { _id: "$orderType", orders: { $sum: 1 }, gmv: { $sum: "$pricing.total" } } }]),
      Order.aggregate([{ $match: match }, { $group: { _id: "$paymentMethod", orders: { $sum: 1 }, gmv: { $sum: "$pricing.total" } } }]),
    ]);

    return ApiResponse.send(res, 200, "Order mix fetched", {
      orderTypeSplit: byType.map((t) => ({ orderType: t._id, orders: t.orders, gmv: round2(t.gmv) })),
      paymentMethodSplit: byPayment.map((p) => ({ method: p._id, orders: p.orders, gmv: round2(p.gmv) })),
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/support-health
const getSupportHealth = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const dateMatch = {};
    if (filters.startDate) dateMatch.$gte = new Date(filters.startDate);
    if (filters.endDate) dateMatch.$lte = new Date(filters.endDate);
    const ticketMatch = {
      ...(Object.keys(dateMatch).length ? { createdAt: dateMatch } : {}),
      ...(restaurantIds ? { restaurant: { $in: toObjectIds(restaurantIds) } } : {}),
    };
    const overdueRestaurantScope = restaurantIds ? { restaurant: { $in: toObjectIds(restaurantIds) } } : {};

    const [totals, resolutionTime, overdueByRestaurant] = await Promise.all([
      SupportTicket.aggregate([
        { $match: ticketMatch },
        { $group: { _id: null, total: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
      ]),
      SupportTicket.aggregate([
        { $match: { ...ticketMatch, status: "resolved", resolvedAt: { $exists: true } } },
        { $addFields: { resolutionHours: { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 3600000] } } },
        { $group: { _id: null, avgHours: { $avg: "$resolutionHours" } } },
      ]),
      // Deliberately NOT date-filtered — "currently overdue" is an operational
      // right-now metric, independent of whichever historical period is selected.
      SupportTicket.aggregate([
        { $match: { status: "open", createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, ...overdueRestaurantScope } },
        { $group: { _id: "$restaurant", count: { $sum: 1 }, oldestHours: { $max: { $divide: [{ $subtract: [new Date(), "$createdAt"] }, 3600000] } } } },
        { $lookup: { from: "restaurants", localField: "_id", foreignField: "_id", as: "r" } },
        { $unwind: "$r" },
        { $project: { restaurantId: "$_id", name: "$r.name", count: 1, oldestHours: { $round: ["$oldestHours", 0] } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const t = totals[0] || { total: 0, resolved: 0 };
    const rt = resolutionTime[0] || { avgHours: null };

    return ApiResponse.send(res, 200, "Support health fetched", {
      totalTickets: t.total,
      resolvedTickets: t.resolved,
      resolutionRatePct: t.total > 0 ? round1((t.resolved / t.total) * 100) : 0,
      avgResolutionHours: rt.avgHours !== null && rt.avgHours !== undefined ? round1(rt.avgHours) : null,
      overdueByRestaurant,
    });
  } catch (error) {
    next(error);
  }
};

// GET /admin/analytics/delivery-health
const getDeliveryHealth = async (req, res, next) => {
  try {
    const filters = req.query;
    const restaurantIds = await resolveRestaurantIds(filters);
    const match = buildPlatformOrderMatch({ ...filters, orderType: "delivery" }, restaurantIds);

    const [dispatch, timing] = await Promise.all([
      // Count every ATTEMPTED dispatch, not just the successful ones. The old
      // query matched taskId:{$exists:true} — which only a SUCCESSFUL dispatch
      // has — and then looked for failures inside that set. A failed dispatch
      // records dispatchFailedReason and no taskId, so it was filtered out
      // before it could be counted: failedDispatches was structurally always
      // 0 and the success rate always 100%. On live data it reported 100%
      // when the true rate was 8 of 22.
      //
      // COD orders are deliberately excluded: they carry
      // flash.status "MANUAL_DELIVERY" with neither field, because the
      // restaurant's own riders handle them. They are not failed dispatches.
      Order.aggregate([
        {
          $match: {
            ...match,
            $or: [
              { "deliveryTracking.flash.taskId": { $exists: true, $nin: [null, ""] } },
              { "deliveryTracking.flash.dispatchFailedReason": { $exists: true, $nin: [null, ""] } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            // Mutually exclusive by construction (see dispatch.service.js: a
            // failure replaces flash wholesale, leaving no taskId), so "no
            // taskId" is the reliable failure test.
            failed: { $sum: { $cond: [{ $ifNull: ["$deliveryTracking.flash.taskId", false] }, 0, 1] } },
          },
        },
      ]),
      // Measure the DELIVERY leg, not the whole order lifecycle. This used to
      // subtract createdAt, so it included checkout, kitchen prep and any time
      // the order sat unattended — on live data that averaged 1867 minutes
      // (31 hours) and was displayed as "Avg Delivery Time".
      //
      // Orders with no dispatch/pickup timestamp are excluded rather than
      // falling back to createdAt: a smaller honest sample beats a number
      // that silently means something else. The card is Flash-specific.
      Order.aggregate([
        { $match: { ...match, status: ORDER_STATUS.DELIVERED, "deliveryTracking.deliveredAt": { $exists: true } } },
        {
          $addFields: {
            legStart: { $ifNull: ["$deliveryTracking.flash.dispatchedAt", "$deliveryTracking.pickedUpAt"] },
          },
        },
        { $match: { legStart: { $ne: null } } },
        { $addFields: { deliveryMinutes: { $divide: [{ $subtract: ["$deliveryTracking.deliveredAt", "$legStart"] }, 60000] } } },
        // Guards against clock skew or a deliveredAt backfilled before dispatch.
        { $match: { deliveryMinutes: { $gt: 0 } } },
        { $group: { _id: null, avgMinutes: { $avg: "$deliveryMinutes" }, count: { $sum: 1 } } },
      ]),
    ]);

    const d = dispatch[0] || { total: 0, failed: 0 };
    const tm = timing[0] || { avgMinutes: null, count: 0 };

    return ApiResponse.send(res, 200, "Delivery health fetched", {
      totalDispatches: d.total,
      failedDispatches: d.failed,
      dispatchSuccessRatePct: d.total > 0 ? round1(((d.total - d.failed) / d.total) * 100) : null,
      avgDeliveryMinutes: tm.avgMinutes !== null && tm.avgMinutes !== undefined ? round1(tm.avgMinutes) : null,
      // Lets the UI show the sample size instead of implying every delivery
      // is represented in the average.
      deliveryTimeSample: tm.count || 0,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFilterOptions,
  getOverview,
  getCities,
  getRestaurantsLeaderboard,
  getCustomersAnalytics,
  getOrderMix,
  getSupportHealth,
  getDeliveryHealth,
};
