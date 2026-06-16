const User = require("../models/User");
const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

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

module.exports = {
  getCustomers,
  getCustomerById,
  blockCustomer,
};
