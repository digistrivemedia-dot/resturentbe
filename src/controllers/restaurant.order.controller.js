const Order = require("../models/Order");
const Notification = require("../models/Notification");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const { createTask, cancelTask } = require("../services/flash.service");

function emitOrderUpdate(restaurantId, order) {
  try {
    const io = getIo();
    if (io) {
      // order.customer may be a populated User doc (updateOrderStatus, cancel,
      // deny-cancel-request) or a raw ObjectId (accept, reject) — the room name
      // must always be the plain hex id, or the emit silently reaches no one.
      const customerId = order.customer?._id || order.customer;
      io.to(`restaurant:${restaurantId}`).emit("order_updated", { order });
      io.to(`customer:${customerId}`).emit("order_status_updated", { order });
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

// PUT /restaurant/orders/:id/cancel — Restaurant cancels an already-accepted
// order (proactively, or approving a customer's cancellation request). If a
// Flash rider task exists, it's only cancelled — and the order only marked
// cancelled — once Flash actually confirms the cancellation; a failed/errored
// Flash call leaves the order untouched so a rider already en route isn't
// silently orphaned.
const cancelOrderByRestaurant = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    }).populate("customer", "name");

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // PLACED orders use reject (not yet accepted); DELIVERED/CANCELLED are terminal.
    if ([ORDER_STATUS.PLACED, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status)) {
      throw new ApiError(400, `Order cannot be cancelled from "${order.status}" status`);
    }

    const flashTaskId = order.deliveryTracking?.flash?.taskId;
    if (flashTaskId) {
      let flashResult;
      try {
        flashResult = await cancelTask(flashTaskId);
      } catch (flashErr) {
        throw new ApiError(502, `Couldn't reach Flash to cancel the rider: ${flashErr.message}. Order was not cancelled — try again.`);
      }
      // Flash's cancelTask is inconsistent with its own createTask: success is a
      // real boolean `true`, but failure comes back as the STRING "0" (confirmed
      // live) — a plain `if (!flashResult.status)` check would treat "0" as
      // truthy and silently cancel the order anyway. Must check `=== true`.
      // The failure reason also lands in `msg`, not `message` (also confirmed live).
      if (flashResult?.status !== true) {
        const rawReason = flashResult?.msg || flashResult?.message;
        const reasonMsg = typeof rawReason === "object" ? Object.values(rawReason).join("; ") : (rawReason || "Flash declined to cancel the task");
        throw new ApiError(502, `Flash couldn't cancel the rider (${reasonMsg}). Order was not cancelled.`);
      }
      order.deliveryTracking.flash.status = flashResult.status_code || "CANCELLED";
    }

    // Approving a customer's pending request (banner "Cancel Order") sends no
    // explicit reason — fall back to the customer's own stated reason so it
    // isn't lost behind a generic message on the customer-facing cancelled screen.
    const isApprovingRequest = order.cancellationRequest?.status === "pending";
    const customerReason = order.cancellationRequest?.reason;

    order.status = ORDER_STATUS.CANCELLED;
    order.cancellation = {
      cancelledBy: "restaurant",
      reason: reason || (isApprovingRequest
        ? (customerReason ? `Cancelled by restaurant — customer requested: "${customerReason}"` : "Cancelled by restaurant (approved customer's cancellation request)")
        : "Cancelled by restaurant"),
    };
    if (isApprovingRequest) {
      order.cancellationRequest.status = "approved";
      order.cancellationRequest.respondedAt = new Date();
    }
    order.statusHistory.push({
      status: ORDER_STATUS.CANCELLED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: order.cancellation.reason,
    });

    await order.save();

    await Notification.create({
      user: order.customer._id,
      title: "Order Cancelled",
      message: `Your order #${order.orderNumber} was cancelled by the restaurant.`,
      type: "order",
      data: { orderId: order._id },
    });

    emitOrderUpdate(req.restaurant._id, order);
    return ApiResponse.send(res, 200, "Order cancelled", { order });
  } catch (error) {
    next(error);
  }
};

// PUT /restaurant/orders/:id/deny-cancel-request — Restaurant declines a
// customer's cancellation request, with a reason shown back to the customer.
// Final — no re-request on the same order (product decision).
const denyCancelRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    }).populate("customer", "name");

    if (!order) {
      throw new ApiError(404, "Order not found");
    }
    if (order.cancellationRequest?.status !== "pending") {
      throw new ApiError(400, "There's no pending cancellation request on this order");
    }

    order.cancellationRequest.status = "denied";
    order.cancellationRequest.restaurantResponse = reason.trim();
    order.cancellationRequest.respondedAt = new Date();
    await order.save();

    await Notification.create({
      user: order.customer._id,
      title: "Cancellation Request Declined",
      message: `The restaurant declined to cancel order #${order.orderNumber}: ${reason.trim()}`,
      type: "order",
      data: { orderId: order._id },
    });

    emitOrderUpdate(req.restaurant._id, order);
    return ApiResponse.send(res, 200, "Cancellation request declined", { order });
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

      const missingProfileFields = [];
      if (!req.restaurant.contact?.phone) missingProfileFields.push("the restaurant's contact phone number (Settings > Location & Hours)");
      if (!req.restaurant.address?.fullAddress) missingProfileFields.push("the restaurant's address (Settings > Location & Hours)");
      // drop_details.contact_number comes from the customer's own account phone —
      // accounts created via Google/OTP sign-in never require one, so this is a
      // real, expected gap for some customers, not a code bug (confirmed against
      // Flash's own validation error).
      if (!order.customer?.phone) missingProfileFields.push("the customer's phone number on their account");
      // Checkout doesn't require a pinned map location on saved addresses (by
      // design — see checkout page), so an order can reach here with a delivery
      // address that has no lat/lng. Flash's drop_details.latitude/longitude
      // would then be undefined and get rejected the same way as the other
      // missing-field cases above.
      if (typeof order.deliveryAddress?.lat !== "number" || typeof order.deliveryAddress?.lng !== "number") {
        missingProfileFields.push("a map location on the customer's delivery address");
      }

      if (order.paymentStatus !== "paid") {
        // Flash's 3PL service rejects unpaid (COD) orders outright — no point calling the API
        console.warn(`[Flash] Skipped dispatch for ${order.orderNumber} — order is COD/unpaid, Flash requires online payment`);
        order.deliveryTracking.flash = {
          status: "CANCELLED",
          dispatchFailedReason: "Cash on Delivery orders aren't supported by Flash — arrange delivery manually",
        };
      } else if (missingProfileFields.length > 0) {
        // Flash's API hard-rejects the request when these are blank (confirmed via
        // its own validation error), so check before calling rather than after.
        const reason = `Missing ${missingProfileFields.join(" and ")} — dispatch can't be requested until this is set, then retry`;
        console.warn(`[Flash] Skipped dispatch for ${order.orderNumber} — ${reason}`);
        order.deliveryTracking.flash = {
          status: "CANCELLED",
          dispatchFailedReason: reason,
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
            // Validation failures come back as msg: { field: "error text" } rather
            // than a single message string — surface those too, not just a generic
            // fallback that would otherwise mislabel a bad payload as "no rider".
            const reason = flashResult.message
              || (flashResult.msg && typeof flashResult.msg === "object"
                    ? Object.values(flashResult.msg).join("; ")
                    : flashResult.msg)
              || "Rider not available";
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
  cancelOrderByRestaurant,
  denyCancelRequest,
  updateOrderStatus,
};
