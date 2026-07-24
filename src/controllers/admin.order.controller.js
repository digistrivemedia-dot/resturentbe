const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../utils/constants");

const getOrders = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentMethod,
      startDate,
      endDate,
      restaurantId,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (restaurantId) query.restaurant = restaurantId;
    if (search) {
      query.$or = [
        { orderNumber: new RegExp(search, "i") },
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("customer", "name email phone")
        .populate("restaurant", "name")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Order.countDocuments(query),
    ]);

    return ApiResponse.send(res, 200, "Orders fetched", {
      orders,
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

const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer", "name email phone")
      .populate("restaurant", "name contact address")
      .lean();

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    return ApiResponse.send(res, 200, "Order fetched", { order });
  } catch (error) {
    next(error);
  }
};

const processRefund = async (req, res, next) => {
  try {
    const { amount, reason } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.paymentMethod === "cod") {
      throw new ApiError(400, "Cannot refund COD orders online");
    }

    if (order.paymentStatus === PAYMENT_STATUS.REFUNDED) {
      throw new ApiError(400, "Order already refunded");
    }

    const refundAmount = amount || order.pricing.total;

    // Mark order as refunded
    order.paymentStatus = PAYMENT_STATUS.REFUNDED;
    order.status = ORDER_STATUS.CANCELLED;
    order.cancellation = {
      cancelledBy: "admin",
      reason: reason || "Refunded by admin",
      refundAmount,
      refundStatus: "processed",
    };
    order.statusHistory.push({
      status: ORDER_STATUS.CANCELLED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: `Refund of ₹${refundAmount} processed by admin. ${reason || ""}`.trim(),
    });

    await order.save();

    // Process refund via Razorpay if payment was online
    if (order.paymentId) {
      try {
        const { createRefund } = require("../services/razorpay.service");
        const refund = await createRefund(order.paymentId, refundAmount, {
          orderNumber: order.orderNumber,
          reason: reason || "Admin refund",
        });
        order.cancellation.refundStatus = "processed";
        await order.save();
      } catch (refundErr) {
        console.error("[Razorpay Refund] Failed:", refundErr.message);
        order.cancellation.refundStatus = "pending";
        await order.save();
      }
    }

    return ApiResponse.send(res, 200, "Refund processed", {
      order,
      refundAmount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrders,
  getOrderById,
  processRefund,
};
