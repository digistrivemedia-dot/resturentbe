const Order = require("../models/Order");
const Notification = require("../models/Notification");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");

// GET /pos/kitchen/orders — the kitchen display queue. Oldest first: the
// ticket that has been waiting longest is the one to cook next.
const getKitchenOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({
      restaurant: req.restaurant._id,
      orderType: "dine_in",
      bill: null,
      status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY] },
    })
      .populate("table", "number seats")
      .populate("placedBy", "name")
      .sort({ createdAt: 1 })
      .lean();

    return ApiResponse.send(res, 200, "Kitchen orders fetched", {
      orders,
      counts: {
        new: orders.filter((o) => o.status === ORDER_STATUS.CONFIRMED).length,
        preparing: orders.filter((o) => o.status === ORDER_STATUS.PREPARING).length,
        ready: orders.filter((o) => o.status === ORDER_STATUS.READY).length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Only forward moves, and only the two the kitchen owns. The kitchen can't
// serve (that's the waiter) or cancel (that's the owner).
const KITCHEN_TRANSITIONS = {
  [ORDER_STATUS.CONFIRMED]: ORDER_STATUS.PREPARING,
  [ORDER_STATUS.PREPARING]: ORDER_STATUS.READY,
};

// PUT /pos/kitchen/orders/:id/advance — "Start preparing" then "Ready to
// serve". One endpoint rather than two near-identical ones; the server decides
// the next status from the current one, so the display can't skip a step or
// send a stale transition after someone else already advanced the ticket.
const advanceOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
      orderType: "dine_in",
    })
      .populate("table", "number")
      .populate("placedBy", "name");

    if (!order) throw new ApiError(404, "Order not found");

    const nextStatus = KITCHEN_TRANSITIONS[order.status];
    if (!nextStatus) {
      throw new ApiError(400, `Nothing for the kitchen to do on an order that's "${order.status}"`);
    }

    // Two cooks tapping the same ticket at once would otherwise both pass the
    // check above and both fire the waiter's "food ready" alert. Claiming the
    // transition against the status we just read means exactly one wins.
    const claim = await Order.updateOne(
      { _id: order._id, status: order.status },
      { $set: { status: nextStatus } }
    );
    if (claim.matchedCount === 0) {
      throw new ApiError(409, "This ticket was just updated — please refresh");
    }

    order.status = nextStatus;
    order.statusHistory.push({
      status: nextStatus,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: nextStatus === ORDER_STATUS.PREPARING ? "Kitchen started preparing" : "Kitchen marked ready to serve",
    });
    await order.save();

    const io = getIo();
    const tableNumber = order.table?.number || "?";

    if (nextStatus === ORDER_STATUS.READY) {
      // THE targeted alert: goes to the one waiter who took this order, not
      // the floor. Several waiters work at once and each only wants their own
      // tables called. `user:<id>` is joined by every authenticated socket
      // (see socket/index.js).
      const waiterId = order.placedBy?._id || order.placedBy;
      if (waiterId) {
        try {
          if (io) {
            io.to(`user:${waiterId}`).emit("order_ready_for_pickup", {
              orderId: order._id,
              orderNumber: order.orderNumber,
              tableId: order.table?._id || order.table,
              tableNumber,
              itemCount: order.items.length,
              readyAt: new Date(),
            });
          }
        } catch (e) {}

        // Persisted too — a waiter whose tablet slept or dropped WiFi must
        // still find out the food is up, rather than it sitting under the heat
        // lamp until someone notices.
        await Notification.create({
          user: waiterId,
          title: `Table ${tableNumber} — order ready`,
          message: `Order #${order.orderNumber} is ready to serve.`,
          type: "order",
          data: { orderId: order._id, restaurantId: req.restaurant._id },
        }).catch(() => {});
      }
    }

    try {
      if (io) io.to(`restaurant:${req.restaurant._id}`).emit("kitchen_order_updated", { order });
    } catch (e) {}

    return ApiResponse.send(
      res,
      200,
      nextStatus === ORDER_STATUS.PREPARING ? "Started preparing" : `Table ${tableNumber} is ready to serve`,
      { order }
    );
  } catch (error) {
    next(error);
  }
};

module.exports = { getKitchenOrders, advanceOrder };
