const Order = require("../models/Order");
const User = require("../models/User");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { getIo } = require("../socket");

// GET /restaurant/customers — everyone who has ordered from this restaurant,
// with their order count here (not their platform-wide order count).
const getCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const restaurantId = req.restaurant._id;

    const orderCounts = await Order.aggregate([
      { $match: { restaurant: restaurantId } },
      { $group: { _id: "$customer", totalOrders: { $sum: 1 }, lastOrderAt: { $max: "$createdAt" } } },
    ]);

    if (orderCounts.length === 0) {
      return ApiResponse.send(res, 200, "Customers fetched", {
        customers: [],
        pagination: { page: 1, limit: parseInt(limit), total: 0, pages: 0 },
      });
    }

    const orderCountMap = {};
    orderCounts.forEach((oc) => { orderCountMap[oc._id.toString()] = oc; });
    const customerIds = orderCounts.map((oc) => oc._id);

    const query = { _id: { $in: customerIds }, role: "customer" };
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
    }

    const users = await User.find(query).select("-password").lean();

    const now = new Date();
    const allCustomers = users
      .map((u) => {
        const stats = orderCountMap[u._id.toString()];
        return {
          ...u,
          totalOrders: stats?.totalOrders || 0,
          lastOrderAt: stats?.lastOrderAt || null,
          isMember: !!(u.membership?.expiresAt && new Date(u.membership.expiresAt) > now),
        };
      })
      // Most orders at this restaurant first — the customers most worth talking to
      .sort((a, b) => b.totalOrders - a.totalOrders);

    const total = allCustomers.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const customers = allCustomers.slice(skip, skip + parseInt(limit));

    return ApiResponse.send(res, 200, "Customers fetched", {
      customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /restaurant/customers/:id/send-membership-popup
const sendMembershipPopup = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const customerId = req.params.id;

    // Security: a restaurant can only message customers who've actually
    // ordered from them, not any customer on the platform.
    const hasOrdered = await Order.exists({ restaurant: restaurantId, customer: customerId });
    if (!hasOrdered) {
      throw new ApiError(403, "This customer hasn't ordered from your restaurant");
    }

    const customer = await User.findOneAndUpdate(
      { _id: customerId, role: "customer" },
      { membershipPopupRequestedAt: new Date() },
      { new: true }
    ).select("-password");

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    try {
      const io = getIo();
      if (io) io.to(`customer:${customer._id}`).emit("membership_popup_requested", {});
    } catch (e) {
      // best-effort
    }

    return ApiResponse.send(res, 200, "Membership popup sent", { customer });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCustomers, sendMembershipPopup };
