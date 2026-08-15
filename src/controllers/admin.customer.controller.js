const User = require("../models/User");
const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { getIo } = require("../socket");

const getCustomers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = { role: "customer" };

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [customers, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    // Order count per customer on this page (avoids an N+1 query per row)
    const customerIds = customers.map((c) => c._id);
    const orderCounts = await Order.aggregate([
      { $match: { customer: { $in: customerIds } } },
      { $group: { _id: "$customer", count: { $sum: 1 } } },
    ]);
    const orderCountMap = {};
    orderCounts.forEach((oc) => { orderCountMap[oc._id.toString()] = oc.count; });

    const now = new Date();
    const customersWithStats = customers.map((c) => ({
      ...c,
      totalOrders: orderCountMap[c._id.toString()] || 0,
      isMember: !!(c.membership?.expiresAt && new Date(c.membership.expiresAt) > now),
    }));

    return ApiResponse.send(res, 200, "Customers fetched", {
      customers: customersWithStats,
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

const getCustomerById = async (req, res, next) => {
  try {
    const customer = await User.findOne({
      _id: req.params.id,
      role: "customer",
    })
      .select("-password")
      .lean();

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    // Fetch order history
    const [orders, totalOrders, totalSpent] = await Promise.all([
      Order.find({ customer: customer._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("restaurant", "name")
        .lean(),
      Order.countDocuments({ customer: customer._id }),
      Order.aggregate([
        {
          $match: {
            customer: customer._id,
            status: "delivered",
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$pricing.total" },
          },
        },
      ]),
    ]);

    return ApiResponse.send(res, 200, "Customer fetched", {
      customer,
      orders,
      totalOrders,
      totalSpent: totalSpent[0]?.total || 0,
    });
  } catch (error) {
    next(error);
  }
};

const blockCustomer = async (req, res, next) => {
  try {
    const customer = await User.findOne({
      _id: req.params.id,
      role: "customer",
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    // Toggle block status
    customer.status = customer.status === "blocked" ? "active" : "blocked";
    await customer.save();

    const action = customer.status === "blocked" ? "blocked" : "unblocked";
    return ApiResponse.send(res, 200, `Customer ${action}`, { customer });
  } catch (error) {
    next(error);
  }
};

// POST /admin/customers/:id/send-membership-popup
const sendMembershipPopup = async (req, res, next) => {
  try {
    const customer = await User.findOneAndUpdate(
      { _id: req.params.id, role: "customer" },
      { membershipPopupRequestedAt: new Date() },
      { new: true }
    ).select("-password");

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    // Deliver instantly if they're online right now; if not, the flag itself
    // (checked on next app open / login) covers delivery either way.
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

module.exports = {
  getCustomers,
  getCustomerById,
  blockCustomer,
  sendMembershipPopup,
};
