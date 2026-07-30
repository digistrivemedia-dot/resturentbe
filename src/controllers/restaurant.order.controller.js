const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const { createTask } = require("../services/flash.service");

function emitOrderUpdate(restaurantId, order) {
  try {
    const io = getIo();
    if (io) {
      io.to(`restaurant:${restaurantId}`).emit("order_updated", { order });
      io.to(`customer:${order.customer}`).emit("order_status_updated", { order });
    }
  } catch (e) {}
}

// Valid status transitions for restaurant — each key maps to allowed next statuses
const VALID_TRANSITIONS = {
  [ORDER_STATUS.CONFIRMED]:        [ORDER_STATUS.PREPARING, ORDER_STATUS.READY],
  [ORDER_STATUS.PREPARING]:        [ORDER_STATUS.READY],
  [ORDER_STATUS.READY]:            [ORDER_STATUS.PICKED_UP, ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.PICKED_UP]:        [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
};

const getOrders = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const {
      filter = "live",
      page = 1,
      limit = 20,
      startDate,
      endDate,
    } = req.query;

    const query = { restaurant: restaurantId };

    // Filter by live or history
    if (filter === "live") {
      query.status = {
        $in: [
          ORDER_STATUS.PLACED,
          ORDER_STATUS.CONFIRMED,
          ORDER_STATUS.PREPARING,
          ORDER_STATUS.READY,
          ORDER_STATUS.PICKED_UP,
          ORDER_STATUS.OUT_FOR_DELIVERY,
        ],
      };
    } else if (filter === "history") {
      query.status = {
        $in: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.CANCELLED],
      };
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("customer", "name phone")
        .sort({ createdAt: -1 })
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
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    })
      .populate("customer", "name phone email")
      .populate("restaurant", "name address")
      .lean();

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    return ApiResponse.send(res, 200, "Order fetched", { order });
  } catch (error) {
    next(error);
  }
};

const acceptOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.status !== ORDER_STATUS.PLACED) {
      throw new ApiError(400, "Order can only be accepted when in placed status");
    }

    order.status = ORDER_STATUS.CONFIRMED;
    order.statusHistory.push({
      status: ORDER_STATUS.CONFIRMED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: "Order accepted by restaurant",
    });

    await order.save();

    emitOrderUpdate(req.restaurant._id, order);
    return ApiResponse.send(res, 200, "Order accepted", { order });
  } catch (error) {
    next(error);
  }
};

const rejectOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.status !== ORDER_STATUS.PLACED) {
      throw new ApiError(400, "Order can only be rejected when in placed status");
    }

    order.status = ORDER_STATUS.CANCELLED;
    order.cancellation = {
      cancelledBy: "restaurant",
      reason: reason || "Rejected by restaurant",
    };
    order.statusHistory.push({
      status: ORDER_STATUS.CANCELLED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: reason || "Rejected by restaurant",
    });

    await order.save();

    emitOrderUpdate(req.restaurant._id, order);
    return ApiResponse.send(res, 200, "Order rejected", { order });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status) {
      throw new ApiError(400, "Status is required");
    }

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    }).populate("customer", "name phone");

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Validate transition
    const allowedNext = VALID_TRANSITIONS[order.status];
    const isDineInCompletion =
      order.orderType === "dine_in" &&
      order.status === ORDER_STATUS.READY &&
      status === ORDER_STATUS.DELIVERED;
    if (!allowedNext || !allowedNext.includes(status) ||
      (status === ORDER_STATUS.DELIVERED && order.status === ORDER_STATUS.READY && !isDineInCompletion)) {
      throw new ApiError(
        400,
        `Cannot transition from "${order.status}" to "${status}"`
      );
    }

    order.status = status;
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: `Status updated to ${status}`,
    });

    // Set delivery timestamps
    if (status === ORDER_STATUS.PICKED_UP) {
      order.deliveryTracking = order.deliveryTracking || {};
      order.deliveryTracking.pickedUpAt = new Date();
    }
    if (status === ORDER_STATUS.DELIVERED) {
      order.deliveryTracking = order.deliveryTracking || {};
      order.deliveryTracking.deliveredAt = new Date();
    }

    // Auto-dispatch a Flash rider once the food is ready (delivery orders only)
    if (status === ORDER_STATUS.READY && order.orderType === "delivery") {
      order.deliveryTracking = order.deliveryTracking || {};

      if (order.paymentStatus !== "paid") {
        // Flash's 3PL service rejects unpaid (COD) orders outright — no point calling the API
        console.warn(`[Flash] Skipped dispatch for ${order.orderNumber} — order is COD/unpaid, Flash requires online payment`);
        order.deliveryTracking.flash = {
          status: "CANCELLED",
          dispatchFailedReason: "Cash on Delivery orders aren't supported by Flash — arrange delivery manually",
        };
      } else {
        console.log(`[Flash] Dispatching rider for ${order.orderNumber} (restaurant: ${req.restaurant.name})`);
        try {
          const flashResult = await createTask(order, req.restaurant, order.customer);
          console.log(`[Flash] createTask response for ${order.orderNumber}:`, JSON.stringify(flashResult));

          if (flashResult.status) {
            order.deliveryTracking.flash = {
              taskId: flashResult.TaskId || flashResult.taskId,
              status: flashResult.Status_code,
              dispatchedAt: new Date(),
            };
            console.log(`[Flash] Task created for ${order.orderNumber}: ${order.deliveryTracking.flash.taskId}`);
          } else {
            const reason = flashResult.message || "Rider not available";
            order.deliveryTracking.flash = {
              status: flashResult.Status_code || "CANCELLED",
              dispatchFailedReason: reason,
            };
            console.warn(`[Flash] Task creation failed for ${order.orderNumber}: ${reason}`);
          }
        } catch (flashErr) {
          order.deliveryTracking.flash = {
            dispatchFailedReason: flashErr.message,
          };
          console.error(`[Flash] createTask error for order ${order.orderNumber}:`, flashErr.message);
        }
      }
    }

    await order.save();

    emitOrderUpdate(req.restaurant._id, order);
    return ApiResponse.send(res, 200, "Order status updated", { order });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrders,
  getOrderById,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
};
